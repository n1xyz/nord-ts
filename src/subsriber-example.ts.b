// import fetch from "node-fetch";
// import WebSocket from "ws";
// import { DeltaEvent } from "./types";
import { Subscriber } from "./nord";

const STREAM_URL =
  "ws://localhost:3000/ws/trades@BTCUSDC&deltas@BTCUSDC&user@0";

const s = new Subscriber({
  streamURL: STREAM_URL,
  maxBufferLen: 5,
});
s.subsribe();
// s.getSnapShot();
