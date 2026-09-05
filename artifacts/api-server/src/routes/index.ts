import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import projectsRouter from "./projects";
import proxyRouter from "./proxy";
import siteProxyRouter from "./site-proxy";
import stripeRouter from "./stripe";
import seoRouter from "./seo";
import domainsRouter from "./domains";
import importRouter from "./import";
import studioRouter from "./studio";
import gcalRouter from "./gcal";
import gscRouter from "./gsc";
import claudeRouter from "./claude";
import voiceRouter from "./voice";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(projectsRouter);
router.use(proxyRouter);
router.use(siteProxyRouter);
router.use(stripeRouter);
router.use(seoRouter);
router.use(domainsRouter);
router.use(importRouter);
router.use(studioRouter);
router.use(gcalRouter);
router.use(gscRouter);
router.use(claudeRouter);
router.use(voiceRouter);

export default router;
