import request from "supertest";
import { createApp } from "../src/app";
import { DEMO_PASSWORD } from "../src/seed/seedData";

export const app = createApp();

export async function login(email: string, password = DEMO_PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").set("X-Requested-With", "DonPimentonERP").send({ email, password });
  if (res.status !== 200) throw new Error(`login ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  const wrap = (m: "get" | "post" | "put" | "delete") => (url: string) => (agent as any)[m](url).set("X-Requested-With", "DonPimentonERP");
  return { agent, get: wrap("get"), post: wrap("post"), put: wrap("put"), del: wrap("delete") };
}
