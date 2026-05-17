import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { apiKeyAuth } from "./middleware";
import routes from "./routes";

const app = express();

app.use(express.json());
app.use(apiKeyAuth);
app.use(routes);

export default app;
