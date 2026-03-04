"use client";

import { ArrowRight } from "lucide-react";
import Link from 'next/link';
import { motion } from 'framer-motion';
import { FloatingPaths } from "@/components/ui/background-paths";

export function CTASection() {
    return (
        <section className="relative w-full min-h-screen flex flex-col items-center justify-center overflow-hidden">
            {/* Full-screen flowing paths background */}
            <div className="absolute inset-0 z-0">
                <FloatingPaths position={1} />
                <FloatingPaths position={-1} />
            </div>

            {/* Central card */}
            <div className="relative z-10 w-full max-w-7xl px-4 md:px-6">
                <div className="relative overflow-hidden rounded-[32px] min-h-[540px] md:min-h-[600px] flex flex-col items-center justify-center duration-500">
                    {/* Content */}
                    <div className="relative z-10 px-8 md:px-12 pt-8 md:pt-12 max-w-4xl mx-auto text-center flex flex-col items-center">
                        {/* Eyebrow badge */}
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.2 }}
                            className="mb-8 inline-flex items-center gap-2 rounded-full border border-[#00EC97]/20 bg-[#00EC97]/10 px-5 py-1.5 text-sm font-semibold tracking-[0.02em] text-[#33f4b0] backdrop-blur-sm"
                        >
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00EC97] opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00EC97]"></span>
                            </span>
                            PREDICTION MARKETS · on NEAR
                        </motion.div>

                        {/* Headline with spring letter animation */}
                        <motion.h1
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.5 }}
                            style={{ fontFamily: "'Clash Display', 'Sora', sans-serif" }}
                            className="text-4xl md:text-6xl lg:text-7xl font-semibold tracking-[-0.03em] text-[#f7fafc] mb-8 leading-[1.06]"
                        >
                            {"Ready when your".split("").map((letter, i) => (
                                <motion.span
                                    key={`line1-${i}`}
                                    initial={{ y: 80, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    transition={{
                                        delay: 0.3 + i * 0.025,
                                        type: "spring",
                                        stiffness: 150,
                                        damping: 25,
                                    }}
                                    className="inline-block"
                                    style={letter === " " ? { width: "0.3em" } : undefined}
                                >
                                    {letter === " " ? "\u00A0" : letter}
                                </motion.span>
                            ))}
                            <br />
                            {"conviction".split("").map((letter, i) => (
                                <motion.span
                                    key={`accent-${i}`}
                                    initial={{ y: 80, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    transition={{
                                        delay: 0.7 + i * 0.03,
                                        type: "spring",
                                        stiffness: 150,
                                        damping: 25,
                                    }}
                                    className="inline-block text-[#00EC97]"
                                >
                                    {letter}
                                </motion.span>
                            ))}
                            {" "}
                            {"is.".split("").map((letter, i) => (
                                <motion.span
                                    key={`tail-${i}`}
                                    initial={{ y: 80, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    transition={{
                                        delay: 1.0 + i * 0.03,
                                        type: "spring",
                                        stiffness: 150,
                                        damping: 25,
                                    }}
                                    className="inline-block"
                                >
                                    {letter}
                                </motion.span>
                            ))}
                        </motion.h1>

                        {/* Description */}
                        <motion.p
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 1.2 }}
                            className="text-[#a3adbc] text-[1.05rem] md:text-[1.28rem] max-w-3xl mb-12 leading-[1.62] font-medium"
                        >
                            Prediction markets with fast execution, clear probabilities,<br className="hidden md:block" />
                            and oracle-backed resolution. Built to feel alive.
                        </motion.p>

                        {/* Actions */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 1.4 }}
                            className="flex gap-4 items-center flex-wrap justify-center"
                        >
                            <Link href="/markets" className="group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-full bg-[#00EC97] pl-8 pr-7 py-4 text-[1.06rem] font-bold text-[#0a0a0f] transition-all duration-300 hover:scale-105 active:scale-95 hover:shadow-[0_0_20px_rgba(0,236,151,0.25)]">
                                <span>Explore Markets</span>
                                <ArrowRight className="h-[18px] w-[18px] shrink-0 transition-transform duration-300 group-hover:translate-x-1" />
                            </Link>
                            <Link href="/create" className="group relative inline-flex items-center justify-center overflow-hidden rounded-full border border-white/25 bg-transparent px-8 py-4 text-[1.06rem] font-semibold text-[#e9edf4] transition-all duration-300 hover:bg-white/5">
                                Create Question
                            </Link>
                        </motion.div>
                    </div>
                </div>
            </div>
        </section>
    );
}
