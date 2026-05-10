import { pgTable, serial, text, real, integer, boolean, timestamp, json, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const trafficLogsTable = pgTable(
  "traffic_logs",
  {
    id: serial("id").primaryKey(),
    laneId: integer("lane_id").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    vehicleCount: integer("vehicle_count").notNull().default(0),
    density: real("density").notNull().default(0),
    cars: integer("cars").notNull().default(0),
    bikes: integer("bikes").notNull().default(0),
    trucks: integer("trucks").notNull().default(0),
    buses: integer("buses").notNull().default(0),
    avgSpeed: real("avg_speed"),
    congestionLevel: text("congestion_level").notNull().default("low"),
  },
  (t) => [
    index("ix_traffic_logs_lane_time").on(t.laneId, t.timestamp),
  ]
);

export const emergencyEventsTable = pgTable(
  "emergency_events",
  {
    id: serial("id").primaryKey(),
    junctionId: integer("junction_id").notNull().default(1),
    laneId: integer("lane_id").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    vehicleType: text("vehicle_type").notNull(),
    confidence: real("confidence").notNull(),
    durationSeconds: integer("duration_seconds"),
    resolved: boolean("resolved").notNull().default(false),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("ix_emergency_events_ts").on(t.timestamp),
  ]
);

export const insertTrafficLogSchema = createInsertSchema(trafficLogsTable).omit({ id: true });
export type InsertTrafficLog = z.infer<typeof insertTrafficLogSchema>;
export type TrafficLog = typeof trafficLogsTable.$inferSelect;

export const insertEmergencyEventSchema = createInsertSchema(emergencyEventsTable).omit({ id: true });
export type InsertEmergencyEvent = z.infer<typeof insertEmergencyEventSchema>;
export type EmergencyEvent = typeof emergencyEventsTable.$inferSelect;

export const signalLogsTable = pgTable(
  "signal_logs",
  {
    id: serial("id").primaryKey(),
    laneId: integer("lane_id").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    phase: text("phase").notNull(),
    greenTimeSec: integer("green_time_sec").notNull(),
    trigger: text("trigger").notNull(),
    densityAtTime: real("density_at_time").notNull().default(0),
  },
  (t) => [
    index("ix_signal_logs_ts").on(t.timestamp),
  ]
);

export const insertSignalLogSchema = createInsertSchema(signalLogsTable).omit({ id: true });
export type InsertSignalLog = z.infer<typeof insertSignalLogSchema>;
export type SignalLog = typeof signalLogsTable.$inferSelect;
