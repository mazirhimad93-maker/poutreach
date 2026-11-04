import { createHandler, database } from "./worker.mjs";

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) throw new Error("Supabase runtime credentials are missing");
Deno.serve(createHandler({ db: database({ url, key }) }));
