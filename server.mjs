import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8080);
const page = await readFile(join(root, "index.html"));
const server = createServer((req, res) => {
 const pathname = new URL(req.url || "/", "http://localhost").pathname;
 res.setHeader("X-Content-Type-Options", "nosniff");
 res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
 if (pathname === "/health") {
  res.writeHead(200, {"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"});
  return res.end("OK");
 }
 if (pathname === "/" || pathname === "/index.html") {
  res.writeHead(200, {"Content-Type":"text/html; charset=utf-8","Cache-Control":"public, max-age=300"});
  return req.method === "HEAD" ? res.end() : res.end(page);
 }
 res.writeHead(404, {"Content-Type":"text/plain; charset=utf-8"});
 res.end("Não encontrado");
});
server.listen(port,"0.0.0.0",()=>console.log("Horizon Site na porta "+port));
