import { serve } from "bun";
import index from "./index.html";

const server = serve({
  port: 3030,
  routes: {
    "/coinflip.riv": new Response(Bun.file("./coinflip/coinflip.riv"), {
      headers: { "Content-Type": "application/octet-stream" },
    }),
    // Serve index.html for all unmatched routes.
    "/*": index,
   },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
