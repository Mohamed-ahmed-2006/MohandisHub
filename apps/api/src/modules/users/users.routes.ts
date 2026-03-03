import { Router } from 'express';

import { usersController } from './users.controller.js';

const usersRouter = Router();

usersRouter.get('/', usersController.listUsers);
usersRouter.get('/:id', usersController.getUserById);

export { usersRouter };
