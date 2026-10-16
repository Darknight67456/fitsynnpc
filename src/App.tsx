import { BrowserRouter, Routes, Route } from 'react-router-dom'

export default function App() {
  return (
    <BrowserRouter>
      {/* <Navbar /> goes here */}
      <Routes>
        <Route path='/login' element={<div>Login</div>} />
        <Route path='/' element={<div>Wardrobe</div>} />
        <Route path='/outfits' element={<div>Outfits</div>} />
        <Route path='/colors' element={<div>Colors</div>} />
        <Route path='/visualizer' element={<div>Visualizer</div>} />
        <Route path='/size' element={<div>Size</div>} />
        <Route path='/insights' element={<div>Insights</div>} />
      </Routes>
    </BrowserRouter>
  )
}