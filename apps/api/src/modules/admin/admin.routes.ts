// ---------------------------------------------------------------------------
// Admin routes — all admin-only endpoints
// ---------------------------------------------------------------------------

import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';
import { requireRole } from '../../middleware/require-role.js';
import { profilesController } from '../profiles/profiles.controller.js';

import { adminController } from './admin.controller.js';

const adminRouter = Router();

adminRouter.use(authenticate, requireEmailVerified, requireRole('admin'));

// Dashboard
adminRouter.get('/dashboard/stats', adminController.getDashboardStats);

// Users
adminRouter.get('/users', adminController.listUsers);
adminRouter.get('/users/:id', adminController.getUserDetail);
adminRouter.patch('/users/:id', adminController.updateUser);
adminRouter.delete('/users/:id', adminController.deleteUser);
adminRouter.post('/users/:id/activate', adminController.activateUser);
adminRouter.post('/users/:id/deactivate', adminController.deactivateUser);
adminRouter.post('/users/:id/send-verification-email', adminController.sendVerificationEmail);
adminRouter.post('/users/:id/verify-email', adminController.verifyEmail);

// Plans
adminRouter.get('/plans', adminController.listPlans);
adminRouter.post('/plans', adminController.createPlan);
adminRouter.patch('/plans/:id', adminController.updatePlan);
adminRouter.delete('/plans/:id', adminController.deletePlan);

// Transactions
adminRouter.get('/transactions', adminController.listTransactions);
adminRouter.get('/transactions/:id', adminController.getTransactionDetail);
adminRouter.post('/transactions/adjust', adminController.adjustBalance);
adminRouter.post('/transactions/:id/reverse', adminController.reverseTransaction);

// Services
adminRouter.get('/services', adminController.listServices);
adminRouter.patch('/services/:id', adminController.updateService);
adminRouter.post('/services/:id/approve', adminController.approveService);
adminRouter.post('/services/:id/reject', adminController.rejectService);

// Categories
adminRouter.get('/categories', adminController.listCategories);
adminRouter.post('/categories', adminController.createCategory);
adminRouter.patch('/categories/:id', adminController.updateCategory);
adminRouter.delete('/categories/:id', adminController.deleteCategory);

// Verifications (existing — delegated to profiles controller)
adminRouter.get('/verification/pending', profilesController.getPendingVerifications);
adminRouter.post('/identity/:docId/review', profilesController.reviewIdentityDocument);
adminRouter.post('/academic/:recordId/review', profilesController.reviewAcademicRecord);
adminRouter.post('/business/:userId/review', profilesController.reviewBusinessDocs);
adminRouter.get('/user/:userId/profile', profilesController.getAnyUserProfile);

export { adminRouter };
