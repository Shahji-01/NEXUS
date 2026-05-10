import { Router } from "express";
import { createHash } from "crypto";

const router = Router();

// Demo credentials — hash comparison
const DEMO_USERS: Record<string, { password: string; role: string }> = {
  admin: { password: "admin123", role: "admin" },
};

function makeToken(username: string): string {
  const payload = Buffer.from(JSON.stringify({ sub: username, exp: Date.now() + 3600000 })).toString("base64");
  const sig = createHash("sha256").update(payload + (process.env["SESSION_SECRET"] ?? "demo-secret")).digest("hex").slice(0, 16);
  return `${payload}.${sig}`;
}

router.post("/auth/login", (req, res): void => {
  const { username, password } = req.body as { username: string; password: string };
  const user = DEMO_USERS[username];
  if (!user || user.password !== password) {
    res.status(401).json({ detail: "Invalid credentials" });
    return;
  }
  res.json({ access_token: makeToken(username), token_type: "bearer" });
});

export default router;
