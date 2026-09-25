// Clerk's middleware validates key *format* at request time and throws without it.
// Route tests mock `authenticate`, so verification never runs — these well-formed
// dummy keys just let clerkMiddleware construct a signed-out context. Real keys
// live in .env (dev) and the production instance (CLERK-7).
process.env.CLERK_PUBLISHABLE_KEY ||= "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";
process.env.CLERK_SECRET_KEY ||= "sk_test_dummy";
