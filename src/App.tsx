import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import Protected from './components/Protected'
import Layout from './components/Layout'
import Login from './pages/Login'
import Wardrobe from './pages/Wardrobe'
import Visualizer from './pages/Visualizer'
import Outfits from './pages/Outfits'
import Stylist from './pages/Stylist'
import Colors from './pages/Colors'
import ComingSoon from './pages/ComingSoon'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path='/login' element={<Login />} />
          <Route element={<Protected><Layout /></Protected>}>
            <Route path='/' element={<Wardrobe />} />
            <Route path='/outfits' element={<Outfits />} />
            <Route path='/stylist' element={<Stylist />} />
            <Route path='/colors' element={<Colors />} />
            <Route path='/visualizer' element={<Visualizer />} />
            <Route path='/size' element={<ComingSoon title='Size and fit' />} />
            <Route path='/insights' element={<ComingSoon title='Insights' />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
