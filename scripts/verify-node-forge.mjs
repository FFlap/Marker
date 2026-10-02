import {
  constants,
  createHash,
  generateKeyPairSync,
  privateEncrypt,
} from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// npm audit cannot detect patch-package fixes. Verify the installed verifier's
// behavior before accepting GHSA-86w9-cpqp-85rv as locally patched.
export function hasStrictForgeDigestValidation(packageDirectory) {
  try {
    const require = createRequire(resolve(packageDirectory, "package.json"));
    const forge = require("./");
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 1024,
    });
    const verifier = forge.pki.publicKeyFromPem(
      publicKey.export({ type: "spki", format: "pem" }),
    );
    const digest = createHash("sha256")
      .update("Marker signature validation check")
      .digest("latin1");
    const { asn1 } = forge;
    const value = (type, constructed, contents) =>
      asn1.create(asn1.Class.UNIVERSAL, type, constructed, contents);

    for (const includeNull of [false, true]) {
      const algorithm = [
        value(
          asn1.Type.OID,
          false,
          asn1.oidToDer(forge.pki.oids.sha256).getBytes(),
        ),
      ];
      if (includeNull) algorithm.push(value(asn1.Type.NULL, false, ""));
      const info = value(asn1.Type.SEQUENCE, true, [
        value(asn1.Type.SEQUENCE, true, algorithm),
        value(asn1.Type.OCTETSTRING, false, digest),
      ]);
      const signature = () =>
        privateEncrypt(
          { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
          Buffer.from(asn1.toDer(info).getBytes(), "latin1"),
        ).toString("latin1");
      if (!verifier.verify(digest, signature())) return false;

      // An otherwise valid signature must not hide an extra algorithm element.
      info.value[0].value.push(
        value(asn1.Type.OCTETSTRING, false, "extra element"),
      );
      try {
        if (verifier.verify(digest, signature())) return false;
      } catch (error) {
        if (!/DigestInfo/.test(error.message)) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
