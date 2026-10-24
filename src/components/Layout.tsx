import { Outlet } from 'react-router-dom'
import Navbar from './Navbar'

export default function Layout() {
  return (
    <>
      <Navbar />
      <main className='mx-auto max-w-6xl p-4'>
        <Outlet />
      </main>
    </>
  )
}
