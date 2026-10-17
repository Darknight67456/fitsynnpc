import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import Protected from './components/Protected'
import Login from './pages/Login'
import Wardrobe from './pages/Wardrobe'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path='/login' element={<Login />} />
          <Route path='/' element={<Protected><Wardrobe /></Protected>} />
          {/* keep your other placeholder routes here, wrapped in <Protected> */}
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}