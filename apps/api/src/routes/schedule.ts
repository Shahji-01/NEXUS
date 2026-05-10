import { Router } from "express";
import {
  getActiveSchedule,
  getAllPlans,
  getAllEvents,
  getDaySchedule,
  addEvent,
  toggleEvent,
  type ScheduledEvent,
} from "../lib/schedule-engine";

const router = Router();

router.get("/schedule/active", (_req, res): void => {
  res.json(getActiveSchedule());
});

router.get("/schedule/plans", (_req, res): void => {
  res.json({ plans: getAllPlans() });
});

router.get("/schedule/events", (_req, res): void => {
  res.json({ events: getAllEvents() });
});

router.get("/schedule/day", (req, res): void => {
  const raw = req.query["day"];
  const day = typeof raw === "string" ? parseInt(raw, 10) : new Date().getDay();
  res.json({ schedule: getDaySchedule(isNaN(day) ? new Date().getDay() : day) });
});

router.post("/schedule/events", (req, res): void => {
  const event = addEvent(req.body as Omit<ScheduledEvent, "id">);
  res.status(201).json({ event });
});

router.post("/schedule/events/:id/toggle", (req, res): void => {
  const active = toggleEvent(req.params["id"] ?? "");
  res.json({ active });
});

export default router;
