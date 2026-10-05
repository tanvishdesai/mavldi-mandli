import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
// Holds expire on their own schedule; this is only the safety net.
crons.interval("expire stale holds", { minutes: 10 }, internal.bookings.sweep, {});
// Uploads that never got attached to a booking, so storage can't be filled for free.
crons.interval("delete orphan uploads", { hours: 6 }, internal.bookings.sweepOrphanFiles, {});
export default crons;
