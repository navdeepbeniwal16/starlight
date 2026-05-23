import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  await prisma.appConfig.upsert({
    where: { key: "APP_NAME" },
    update: {},
    create: { key: "APP_NAME", value: "Hello from the database!" },
  });
  console.log("Seeded AppConfig.APP_NAME");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
