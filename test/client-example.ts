import { Nord } from "./nord";
import { FillMode, Side } from "./types";

const main: any = async () => {
  const c = await Nord.createClient({ url: "http://localhost:3000" });
  console.log(c.markets);
  console.log(c.tokens);
  console.log(`userId: ${c.userId}`);
  console.log(`sessionId: ${c.sessionId}`);

  // let userId = await c.createUser().send();
  // console.log(`userId: ${userId}`);

  // let sessionId = await c.createSession(userId).send();
  // console.log(`sessionId: ${sessionId}`);

  try {
    await c.deposit(0, 10000000);
  } catch (e: any) {
    console.log(`couldn't do deposit, reason: ${e}`);
  }

  try {
    await c.withdraw(0, 100);
  } catch (e: any) {
    console.log(`couldn't do withdraw, reason: ${e}`);
  }

  // const orderId = await c.placeOrder(0, Side.Ask, FillMode.Limit, false, 1, 1)
  // console.log(`orderID: ${orderId}`)

  // const orderId2 = await c.cancelOrder(0, orderId)
  // console.log(`orderId2: ${orderId2}`)

  const marketId = 0;
  const size = 1;
  const price = 1;
  const isReduceOnly = false;
  let orderId: number = 0;
  try {
    orderId = await c.placeOrder(
      marketId,
      Side.Ask,
      FillMode.Limit,
      isReduceOnly,
      size,
      price,
    );
    console.log(`orderId: ${orderId}`);
  } catch (e: any) {
    console.log(`couldn't do placeOrder, reason: ${e}`);
  }

  try {
    const orderId2 = await c.cancelOrder(marketId, orderId);
    console.log(`orderId: ${orderId2}`);
  } catch (e: any) {
    console.log(`couldn't do cancelOrder, reason: ${e}`);
  }

  // let resp = await axios.get('https://ifconfig.me');
  // console.log(`resp status: ${resp.status}`);
  // console.log(`resp data: ${resp.data}`);
};

console.log("before");
main();
console.log("after");
