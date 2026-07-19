"use client";
import { motion } from "framer-motion";
import { Scissors, Wand2 } from "lucide-react";

const tools = [
  {
    icon: Wand2,
    title: "Background Remover",
    description: "Erase image backgrounds in seconds with AI segmentation. Get a clean, transparent PNG instantly.",
    badge: "Active",
    href: "/",
  },
  {
    icon: Scissors,
    title: "Object Remover",
    description: "Paint over any unwanted object — people, cars, power lines — and let AI fill it in naturally.",
    badge: "Coming soon",
    href: "#",
  },
];

const badgeStyles: Record<string, string> = {
  "Active":       "bg-emerald-500/15 text-emerald-600 border border-emerald-500/25",
  "Coming soon":  "bg-muted text-muted-foreground border border-[var(--glass-border)]",
};

export default function OtherTools() {
  return (
    <section id="tools" className="py-20 px-4 bg-muted/30">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-14"
        >
          <p className="text-sm font-semibold text-primary uppercase tracking-widest mb-3">Our tools</p>
          <h2 className="text-3xl sm:text-4xl font-black text-foreground mb-4">
            More from SalluLabs
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            A growing suite of free, AI-powered image tools — fast, private, and built for the browser.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-3xl mx-auto">
          {tools.map((tool, i) => (
            <motion.div
              key={tool.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: i * 0.07 }}
            >
              <a
                href={tool.href}
                className={`step-card glass rounded-2xl p-6 flex flex-col gap-4 border border-[var(--glass-border)] block
                  ${tool.href === "#" ? "cursor-default opacity-80" : "hover:border-primary/40"}`}
              >
                <div className="flex items-start justify-between">
                  <div className="w-11 h-11 rounded-xl btn-gradient flex items-center justify-center shrink-0">
                    <tool.icon size={20} className="text-black" />
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${badgeStyles[tool.badge] ?? badgeStyles["Coming soon"]}`}>
                    {tool.badge}
                  </span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground mb-1">{tool.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{tool.description}</p>
                </div>
              </a>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}