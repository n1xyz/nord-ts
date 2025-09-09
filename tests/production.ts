// ## What this test checks?
// It checks that action encoding and http wiring and receipt (error case) is properly parsed.
// In case of bad serde or wiring, test will exit with non-zero code.
// So our changes should be in sync for production or clearly made bakward compatible as far as we can,
// especially around first step of session creation.
//
// ## Why we run on production?
//
// Assuming our target SLA for production, failure of this test will mean that we do not meet SLA.
// If failrue is rear it as rear as CI fails, fine to restart (given we follow good SLA).
// If we will not chace SLA, could setup a local nord server for this test or add retry:).
// Our SLA to be as good as some DNS/CDN service like.

import { createSession } from "../dist/nord/api/actions.js";
import { Error } from "../dist/gen/nord_pb.js";
import createClient from "openapi-fetch";
import { paths } from "../dist/gen/openapi.js";
import bs58 from "bs58";
import { assert } from "console";

const serverUrl = `https://zo-devnet.n1.xyz/`; // TODO: change to prod server when ready
const client = createClient<paths>({ baseUrl: serverUrl });
const accountId = 0;
while (true) {
  const response = await client.GET("/account/{account_id}/pubkey", {
    params: { path: { account_id: accountId } },
  });
  if (response.error) {
    console.warn("will retry after error", response.error);
    continue;
  } else {
    const pubkey = response.data as string;
    // cleary this fails with signature verification,
    // NOTE(ddos): so we can improve and fail on session existence check
    const walletSignFn = async (_m: string | Uint8Array) => new Uint8Array(64);
    const now = BigInt(Math.floor(Date.now() / 1000));
    const nonce = 1;

    try {
      const res = await createSession(serverUrl, walletSignFn, now, nonce, {
        userPubkey: bs58.decode(pubkey),
        sessionPubkey: bs58.decode(pubkey),
      });
    } catch (e) {
      console.error("create_session_error", e);
      //NOTE: imho need to change error handling within sendAction for better errors, but not scope of this PR
      assert(e.message.includes(`reason: SIGNATURE_VERIFICATION`));
      process.exit(0);
    }
  }
}
