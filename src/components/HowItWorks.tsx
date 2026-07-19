"use client";
import { motion } from "framer-motion";
import { Upload, Wand2, Download } from "lucide-react";

const steps = [
  {
    icon: Upload,
    number: "01",
    title: "Upload Your Image",
    description:
      "Drag & drop or click to upload the photo you want to clean up. We support PNG, JPG, and WEBP up to 5MB (10MB for signed-in users).",
  },
  {
    icon: Wand2,
    number: "02",
    title: "Click Remove Background",
    description:
      "Pick Fast (free) or Pro (sign-in) mode, then hit the magic button. Our AI detects the subject and erases everything behind it.",
  },
  {
    icon: Download,
    number: "03",
    title: "Download Transparent PNG",
    description:
      "Get a clean, transparent PNG in seconds. Use it for product shots, profile pictures, thumbnails, or any creative project.",
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <p className="text-sm font-semibold text-primary uppercase tracking-widest mb-3">How it works</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground">
            Three steps to a transparent image
          </h2>
          <p className="text-muted-foreground mt-4 max-w-xl mx-auto">
            No green screen. No manual masking. No software to install. Just upload, remove, and download.
          </p>
        </motion.div>

        {/* Steps */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {steps.map((step, i) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="step-card glass rounded-2xl p-8 flex flex-col gap-5"
            >
              {/* Number circle */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full btn-gradient flex items-center justify-center text-black font-black text-sm shrink-0">
                  {step.number}
                </div>
                <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                  <step.icon size={16} className="text-primary" />
                </div>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{step.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{step.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}