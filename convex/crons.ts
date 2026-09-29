import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
// Holds expire on their own schedule; this is only the safety net.
crons.interval("expire stale holds", { minutes: 10 }, internal.bookings.sweep, {});
export default crons;
