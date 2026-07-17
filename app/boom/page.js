export const dynamic = "force-dynamic";

async function inner() {
  throw new Error("simulated backend failure");
}

export default async function Boom() {
  await inner();
  return <div>never</div>;
}
