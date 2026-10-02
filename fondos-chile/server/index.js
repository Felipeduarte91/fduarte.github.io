import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { crearApp } from "./app.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = await crearApp({
  publicDir: join(raiz, "public"),
  storeFile: process.env.STORE_FILE || join(raiz, "server", "storage", "proyectos.json"),
  adminToken: process.env.ADMIN_TOKEN || "",
  allowOrigin: process.env.ALLOW_ORIGIN || ""
});
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log("Brújula de Fondos Chile en http://localhost:" + port));
