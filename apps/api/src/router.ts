import { router, publicProcedure } from "./trpc";
import { prisma } from "./lib/prisma";

export const appRouter = router({
  healthcheck: publicProcedure.query(() => ({ status: "ok" })),

  appName: publicProcedure.query(async () => {
    const config = await prisma.appConfig.findUnique({
      where: { key: "APP_NAME" },
    });
    return config?.value ?? "Starlight";
  }),
});

export type AppRouter = typeof appRouter;
