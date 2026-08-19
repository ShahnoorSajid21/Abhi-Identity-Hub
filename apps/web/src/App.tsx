import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Shell } from './app/Shell.tsx';
import { PAGE_TITLES } from './copy/strings.ts';
import { ToastProvider } from './components/Toast.tsx';
import { UnderConstruction } from './pages/UnderConstruction.tsx';
import { PoliciesPage } from './pages/PoliciesPage.tsx';
import { CustomersPage } from './pages/CustomersPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { CustomerProfilePage } from './pages/CustomerProfilePage.tsx';
import { CompliancePage } from './pages/CompliancePage.tsx';
import { OnboardingPage } from './pages/OnboardingPage.tsx';
import { QueuePage, QueueRequestPage } from './pages/QueuePage.tsx';
import { AuditPage } from './pages/AuditPage.tsx';

/**
 * Routes. Every screen is reachable by typing its address, so a mis-click
 * during the demo is recoverable without clicking backwards through the app.
 *
 * Customers are addressed by subject id, never by CNIC. A CNIC is the primary
 * identifier of a Pakistani citizen and putting one in a path would put it in
 * browser history and every referrer header the page emits.
 */
export function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<DashboardPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route
              path="customers/new"
              element={<UnderConstruction title={PAGE_TITLES.newCustomer} section="5.9" />}
            />
            <Route
              path="customers/:subjectId"
              element={<CustomerProfilePage />}
            />
            <Route
              path="queue"
              element={<QueuePage />}
            />
            <Route
              path="queue/:requestId"
              element={<QueueRequestPage />}
            />
            <Route
              path="onboarding"
              element={<OnboardingPage />}
            />
            <Route
              path="compliance"
              element={<CompliancePage />}
            />
            <Route
              path="audit"
              element={<AuditPage />}
            />
            <Route path="settings/policies" element={<PoliciesPage />} />
            <Route path="*" element={<UnderConstruction title="Not found" section="—" />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
