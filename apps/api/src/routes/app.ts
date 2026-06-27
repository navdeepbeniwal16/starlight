import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

router.get("/name", async (_req, res) => {
  const config = await prisma.appConfig.findUnique({
    where: { key: "APP_NAME" },
  });
  res.json({ name: config?.value ?? "Starlight" });
});

export default router;
