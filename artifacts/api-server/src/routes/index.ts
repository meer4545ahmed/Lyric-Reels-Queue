import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storageRouter from "./storage";
import videosRouter from "./videos";
import settingsRouter from "./settings";
import facebookRouter from "./facebook";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(videosRouter);
router.use(settingsRouter);
router.use(facebookRouter);

export default router;
