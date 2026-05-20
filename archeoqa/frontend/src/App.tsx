import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import ChatPage from './pages/ChatPage';
import LibraryPage from './pages/LibraryPage';
import MatrixPage from './pages/MatrixPage';
import SimilarityPage from './pages/SimilarityPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-hidden flex flex-col">
          <Routes>
            <Route path="/" element={<ChatPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/matrix" element={<MatrixPage />} />
            <Route path="/similarity" element={<SimilarityPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
