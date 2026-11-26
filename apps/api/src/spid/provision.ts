import { randomBytes } from "node:crypto";
import type { ObjectId } from "mongodb";
import { hashPassword } from "../auth/password.js";
import { users, type UserDoc } from "../models/collections.js";
import type { MappedSpidIdentity } from "./attributes.js";

export async function findOrCreateSpidUser(
  identity: MappedSpidIdentity,
): Promise<UserDoc & { _id: ObjectId }> {
  const col = users();
  const now = new Date();

  let user =
    (identity.fiscalNumber
      ? await col.findOne({ fiscalNumber: identity.fiscalNumber })
      : null) ?? (await col.findOne({ email: identity.email }));

  if (user) {
    if (user.active === false) {
      throw new Error("Account disabled");
    }
    await col.updateOne(
      { _id: user._id },
      {
        $set: {
          fiscalNumber: identity.fiscalNumber ?? user.fiscalNumber ?? null,
          spidCode: identity.spidCode ?? user.spidCode ?? null,
          authProvider: user.authProvider ?? "spid",
          updatedAt: now,
        },
      },
    );
    const refreshed = await col.findOne({ _id: user._id });
    if (!refreshed) throw new Error("User vanished after SPID update");
    return refreshed;
  }

  const passwordHash = await hashPassword(randomBytes(32).toString("hex"));
  const doc: Omit<UserDoc, "_id"> = {
    email: identity.email,
    passwordHash,
    role: "user",
    active: true,
    fiscalNumber: identity.fiscalNumber,
    spidCode: identity.spidCode,
    authProvider: "spid",
    createdAt: now,
    updatedAt: now,
  };
  const result = await col.insertOne(doc as never);
  const created = await col.findOne({ _id: result.insertedId });
  if (!created) throw new Error("Failed to create SPID user");
  return created;
}
