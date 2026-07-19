import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import HowItWorks from "@/components/HowItWorks";
import OtherTools from "@/components/OtherTools";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <main className="min-h-screen aurora-bg">
      <Navbar />
      <Hero />
      <HowItWorks />
      <OtherTools />
      <Footer />
    </main>
  );
}