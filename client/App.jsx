import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.jsx';
import { LangProvider } from './i18n.jsx';
import { UIProvider, Loading } from './components/ui.jsx';
import Layout, { ChangePasswordModal } from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Announcements from './pages/Announcements.jsx';
import Receipt from './pages/Receipt.jsx';
import Security from './pages/Security.jsx';
import Notifications from './pages/Notifications.jsx';
import Stories from './pages/Stories.jsx';
import { Impact, Verify } from './pages/Public.jsx';
import StudentDashboard from './pages/student/Dashboard.jsx';
import StudentCertificates from './pages/student/Certificates.jsx';
import StudentSupport from './pages/student/Support.jsx';
import StudentProfile from './pages/student/Profile.jsx';
import StudentProgress from './pages/student/Progress.jsx';
import StudentScholarships from './pages/student/Scholarships.jsx';
import StudentEvents from './pages/student/Events.jsx';
import DonorDashboard from './pages/donor/Dashboard.jsx';
import DonorDonations from './pages/donor/Donations.jsx';
import DonorProfile from './pages/donor/Profile.jsx';
import Donate from './pages/donor/Donate.jsx';
import DonorProjects from './pages/donor/Projects.jsx';
import DonorSponsorships from './pages/donor/Sponsorships.jsx';
import DonorPledges from './pages/donor/Pledges.jsx';
import AdminDashboard from './pages/admin/Dashboard.jsx';
import Students from './pages/admin/Students.jsx';
import StudentDetail from './pages/admin/StudentDetail.jsx';
import CertificateReview from './pages/admin/Certificates.jsx';
import Aid from './pages/admin/Aid.jsx';
import Donors from './pages/admin/Donors.jsx';
import DonorDetail from './pages/admin/DonorDetail.jsx';
import Donations from './pages/admin/Donations.jsx';
import Import from './pages/admin/Import.jsx';
import Users from './pages/admin/Users.jsx';
import Settings from './pages/admin/Settings.jsx';
import Audit from './pages/admin/Audit.jsx';
import Academics from './pages/admin/Academics.jsx';
import Documents from './pages/admin/Documents.jsx';
import Scholarships from './pages/admin/Scholarships.jsx';
import Sponsorships from './pages/admin/Sponsorships.jsx';
import Projects, { ProjectDetail } from './pages/admin/Projects.jsx';
import { Pledges, Expenses, Payments, Stories as AdminStories } from './pages/admin/Finance.jsx';
import { Events, EventDetail, Volunteers, Villages, VillageDetail } from './pages/admin/Community.jsx';
import Reports from './pages/admin/Reports.jsx';
import Messages from './pages/admin/Messages.jsx';

function roleRoutes(role) {
  switch (role) {
    case 'student':
      return <>
        <Route index element={<StudentDashboard />} />
        <Route path="certificates" element={<StudentCertificates />} />
        <Route path="progress" element={<StudentProgress />} />
        <Route path="scholarships" element={<StudentScholarships />} />
        <Route path="support" element={<StudentSupport />} />
        <Route path="events" element={<StudentEvents />} />
        <Route path="profile" element={<StudentProfile />} />
      </>;
    case 'donor':
      return <>
        <Route index element={<DonorDashboard />} />
        <Route path="donate" element={<Donate />} />
        <Route path="donations" element={<DonorDonations />} />
        <Route path="pledges" element={<DonorPledges />} />
        <Route path="sponsorships" element={<DonorSponsorships />} />
        <Route path="projects" element={<DonorProjects />} />
        <Route path="stories" element={<Stories />} />
        <Route path="profile" element={<DonorProfile />} />
      </>;
    default:
      return <>
        <Route index element={<AdminDashboard />} />
        <Route path="students" element={<Students />} />
        <Route path="students/:id" element={<StudentDetail />} />
        <Route path="certificates" element={<CertificateReview />} />
        <Route path="academics" element={<Academics />} />
        <Route path="scholarships" element={<Scholarships />} />
        <Route path="aid" element={<Aid />} />
        <Route path="events" element={<Events />} />
        <Route path="events/:id" element={<EventDetail />} />
        <Route path="donors" element={<Donors />} />
        <Route path="donors/:id" element={<DonorDetail />} />
        <Route path="donations" element={<Donations />} />
        <Route path="pledges" element={<Pledges />} />
        <Route path="sponsorships" element={<Sponsorships />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:id" element={<ProjectDetail />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="payments" element={<Payments />} />
        <Route path="villages" element={<Villages />} />
        <Route path="villages/:name" element={<VillageDetail />} />
        <Route path="volunteers" element={<Volunteers />} />
        <Route path="stories" element={<AdminStories />} />
        <Route path="reports" element={<Reports />} />
        <Route path="import" element={<Import />} />
        <Route path="documents" element={<Documents />} />
        {role === 'super_admin' && <>
          <Route path="users" element={<Users />} />
          <Route path="messages" element={<Messages />} />
          <Route path="settings" element={<Settings />} />
          <Route path="audit" element={<Audit />} />
        </>}
      </>;
  }
}

function Routed() {
  const { user, ready } = useAuth();
  if (!ready) return <Loading />;
  return (
    <>
      <Routes>
        {/* Public pages work with or without signing in */}
        <Route path="/impact" element={<Impact />} />
        <Route path="/verify/:code" element={<Verify />} />
        {!user ? <Route path="*" element={<Login />} /> : <>
          <Route path="/receipt/:id" element={<Receipt />} />
          <Route element={<Layout />}>
            {roleRoutes(user.role)}
            <Route path="announcements" element={<Announcements />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="security" element={<Security />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </>}
      </Routes>
      {user?.must_change_password && <ChangePasswordModal forced onClose={() => {}} />}
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <LangProvider>
        <UIProvider>
          <AuthProvider>
            <Routed />
          </AuthProvider>
        </UIProvider>
      </LangProvider>
    </BrowserRouter>
  );
}
