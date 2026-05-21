import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import agentsRouter from "./agents";
import settingsRouter from "./settings";
import salesRouter from "./sales";
import entriesRouter from "./entries";
import paymentsRouter from "./payments";
import calculationsRouter from "./calculations";
import reportsRouter from "./reports";
import reserveRouter from "./reserve";
import notificationsRouter from "./notifications";
import gamesRouter from "./games";
import expensesRouter from "./expenses";
import entryChangeRequestsRouter from "./entry-change-requests";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(agentsRouter);
router.use(settingsRouter);
router.use(salesRouter);
router.use(entriesRouter);
router.use(entryChangeRequestsRouter);
router.use(expensesRouter);
router.use(paymentsRouter);
router.use(calculationsRouter);
router.use(reportsRouter);
router.use(reserveRouter);
router.use(notificationsRouter);
router.use(gamesRouter);

export default router;
