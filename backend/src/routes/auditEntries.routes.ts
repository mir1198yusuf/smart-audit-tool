import { Router } from 'express';
import { AuditController } from '../controllers/AuditController.js';

const router = Router();
const controller = new AuditController();

router.post('/', controller.create);
router.get('/', controller.list);
router.put('/:id', controller.update);
router.get('/:id/similar', controller.similar);

export default router;
