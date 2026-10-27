import { createApp } from "./app";
import { config } from "./config";

createApp().listen(config.port, () => {
  console.log(`Don Pimentón ERP API escuchando en http://localhost:${config.port}`);
});
