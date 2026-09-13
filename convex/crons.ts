import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("Verlopen opdrachten en koppelingen", { minutes: 1 }, internal.cleanup.expired, {});
crons.interval("Onvoltooide uploads opruimen", { hours: 1 }, internal.cleanup.orphanedUploads, {});
export default crons;
