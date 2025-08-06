'use client';

import { Analytics } from '@vercel/analytics/next';
import { useEffect, useRef, useState } from "react";
import { ethers } from 'ethers';

// Contract choices
const CONTRACT_OPTIONS = [
  { key: '1st', name: '1st', address: '0x8D1cc702453fa889f137DBD5734CDb7Ee96B6Ba0' },
  { key: '2nd', name: '2nd', address: '0xee6d4e937f0493fb461f28a75cf591f1dba8704e' },
  { key: 'adv', name: 'Adversarial', address: '0x216f071653a82ced3ef9d29f3f0c0ed7829c8f81' },
];

const DEFAULT_RPCS = [
  "https://1rpc.io/sepolia",
  "https://ethereum-sepolia-rpc.publicnode.com"
];


// Spinner
function Spinner() {
  return (
    <svg className="animate-spin h-5 w-5 text-white inline-block mr-2" viewBox="0 0 24 24">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
    </svg>
  );
}
function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function setCookie(name: string, value: string, days = 180) {
  const expires = new Date(Date.now() + days*24*60*60*1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}
function getCookie(name: string) {
  const v = document.cookie.match('(^|;) ?' + name + '=([^;]*)(;|$)');
  return v ? decodeURIComponent(v[2]) : '';
}

function formatBigIntWithCommas(str: string | number | bigint) {
  try {
    return BigInt(str).toLocaleString();
  } catch {
    return str?.toString() ?? '';
  }
}


// Helper to get one epoch reward and cumulative
async function fetchEpochReward(provider: any, rollup: string, prover: string, epoch: number, startCum: bigint) {
  try {
    const callData = ethers.concat([
      ethers.id("getSpecificProverRewardsForEpoch(uint256,address)").substring(0, 10),
      ethers.zeroPadValue(ethers.toBeHex(epoch), 32),
      ethers.zeroPadValue(prover, 32),
    ]);
    const rewardsHex = await provider.call({ to: rollup, data: callData });
    const rewards = BigInt(rewardsHex);
    const cumulative = startCum + rewards;
    return {
      epoch,
      rewards: rewards.toString(),
      rewardsSTK: parseFloat(ethers.formatEther(rewards)).toFixed(6),
      cumulativeSTK: parseFloat(ethers.formatEther(cumulative)).toFixed(6),
      isPending: false,
      cumulative,
    };
  } catch {
    return {
      epoch,
      rewards: "0",
      rewardsSTK: "0.000000",
      cumulativeSTK: parseFloat(ethers.formatEther(startCum)).toFixed(6),
      isPending: false,
      cumulative: startCum,
    };
  }
}

async function fetchSharesFor(
  provider: ethers.Provider,
  rollup: string,
  prover: string,
): Promise<{ shares: string; sharesNum: bigint }> {
  const callData = ethers.concat([
    ethers.id("getSharesFor(address)").substring(0, 10),
    ethers.zeroPadValue(prover, 32),
  ]);

  const sharesHex = await provider.call({ to: rollup, data: callData });
  const sharesNum = BigInt(sharesHex);
  return {
    shares:    sharesNum.toString(),
    sharesNum,
  };
}

export default function Home() {
  const [shares, setShares] = useState<string | null>(null);
  const [proverAddress, setProverAddress] = useState('');
  const [rpcUrl, setRpcUrl] = useState('');
  const [contractKey, setContractKey] = useState('adv');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [currentEpoch, setCurrentEpoch] = useState<number | null>(null);
  const [finalizedTotal, setFinalizedTotal] = useState<string>('0');
  const [pendingReward, setPendingReward] = useState<string>('0');
  const [error, setError] = useState<string>('');
  const [progress, setProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [resumeData, setResumeData] = useState<{lastEpoch: number, cumulative: string, latestEpoch: number}|null>(null);
  const [resumeChoice, setResumeChoice] = useState<'resume'|'restart'|null>(null);

  const ROLLUP_ADDRESS = CONTRACT_OPTIONS.find(opt => opt.key === contractKey)?.address ?? CONTRACT_OPTIONS[2].address;
  const stopped = useRef(false);
  const handleStop = () => { stopped.current = true; };

  useEffect(() => {
    setProverAddress(getCookie('proverAddress') || 'your-prover-address-here (0x...)');
    setRpcUrl(getCookie('rpcUrl'));
  }, []);
  useEffect(() => { if (proverAddress) setCookie('proverAddress', proverAddress); }, [proverAddress]);
  useEffect(() => { if (rpcUrl) setCookie('rpcUrl', rpcUrl); }, [rpcUrl]);

  const getProgress = async (prover: string, contract: string) => {
    const r = await fetch(`/api/progress?prover=${encodeURIComponent(prover)}&contract=${encodeURIComponent(contract)}`);
    if (!r.ok) return { lastEpoch: -1, cumulativeRewards: "0" };
    const data = await r.json();
    return {
      lastEpoch: typeof data.lastEpoch === "number" ? data.lastEpoch : -1,
      cumulativeRewards: data.cumulativeRewards || "0",
    };
  };
  const saveProgress = async (prover: string, contract: string, lastEpoch: number, cumulativeRewards: string) => {
    await fetch('/api/progress', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ prover, contract, lastEpoch, cumulativeRewards }),
    });
  };

  // Fetch history up to (and including) lastEpoch for display
  const fetchHistory = async (provider: any, rollup: string, prover: string, upto: number, startCum: string) => {
    let cum = BigInt(startCum || "0");
    const resultArr = [];
    for (let i = 0; i <= upto; i++) {
      const r = await fetchEpochReward(provider, rollup, prover, i, cum);
      resultArr.push(r);
      cum = r.cumulative;
    }
    return { resultArr, cum };
  };

  // MAIN entry point
  const startScan = async () => {
    setLoading(true);
    setError('');
    setResults([]);
    setFinalizedTotal('0');
    setPendingReward('0');
    setProgress({ current: 0, total: 0 });
    setResumeData(null);
    setResumeChoice(null);

    try {
      const getProvider = () => {
        // Use user input, or default to first RPC
        const url = rpcUrl && rpcUrl.trim() !== "" ? rpcUrl : DEFAULT_RPCS[0];
        return new ethers.JsonRpcProvider(url);
      };
      const provider = getProvider();

      // Fetch shares for prover
      try {
        const { shares } = await fetchSharesFor(provider, ROLLUP_ADDRESS, proverAddress);
        setShares(shares);
      } catch {
        setShares(null);
      }


      const currentEpochHex = await provider.call({
        to: ROLLUP_ADDRESS,
        data: ethers.id("getCurrentEpoch()").substring(0, 10),
      });
      const latestEpoch = parseInt(currentEpochHex, 16);
      setCurrentEpoch(latestEpoch);
      setProgress({ current: 0, total: latestEpoch });

      // Get DB progress
      const { lastEpoch, cumulativeRewards } = await getProgress(proverAddress, ROLLUP_ADDRESS);
      const lastFinalizedEpoch = latestEpoch - 2;

      // If we're already at tip, just show summary + pending row
      if (lastEpoch >= lastFinalizedEpoch) {
        setResults([
          {
            epoch: `0–${lastEpoch}`,
            rewards: '-',
            rewardsSTK: '-',
            cumulativeSTK: parseFloat(ethers.formatEther(BigInt(cumulativeRewards))).toFixed(6),
            isPending: false,
            status: 'Loaded from DB',
          }
        ]);
        setFinalizedTotal(ethers.formatEther(BigInt(cumulativeRewards)));

        // Fetch pending (currentEpoch-1)
        if (latestEpoch > 0) {
          const pending = await fetchEpochReward(provider, ROLLUP_ADDRESS, proverAddress, latestEpoch-1, BigInt(cumulativeRewards));
          pending.isPending = true;
          setPendingReward(pending.rewardsSTK);
          setResults(res => [...res, pending]);
        }

        setLoading(false);
        return;
      }

      // Not at tip, show summary row and offer resume
      if (lastEpoch >= 0 && lastEpoch < lastFinalizedEpoch) {
        setResults([
          {
            epoch: `0–${lastEpoch}`,
            rewards: '-',
            rewardsSTK: '-',
            cumulativeSTK: parseFloat(ethers.formatEther(BigInt(cumulativeRewards))).toFixed(6),
            isPending: false,
            status: 'Loaded from DB',
          }
        ]);
        setFinalizedTotal(ethers.formatEther(BigInt(cumulativeRewards)));
        setResumeData({ lastEpoch, cumulative: cumulativeRewards, latestEpoch });
        setLoading(false);
        return;
      }

      // No progress, scan all
      await scanRewards(0, latestEpoch, "0", true);
      setResumeData(null);
    } catch (err: any) {
      setError(err.message || 'An error occurred');
      setLoading(false);
      setResumeData(null);
    }
  };

  // Scans *only* new finalized epochs and saves at the end. Then fetches pending row.
  const scanRewards = async (
    fromEpoch: number,
    toEpoch: number,
    startCumulative: string,
    overwriteDB = false
  ) => {
    stopped.current = false;
    setLoading(true);
    let cum = BigInt(startCumulative || "0");
    let liveResults: any[] = [];
    let lastFinalizedEpoch = fromEpoch - 1;
    let lastFinalizedCum = BigInt(startCumulative || "0");
    const getProvider = () => {
      // Use user input, or default to first RPC
      const url = rpcUrl && rpcUrl.trim() !== "" ? rpcUrl : DEFAULT_RPCS[0];
      return new ethers.JsonRpcProvider(url);
    };
    const provider = getProvider();


    // Optionally reset progress ONLY IF starting over from zero
    if (overwriteDB && fromEpoch === 0) {
      await saveProgress(proverAddress, ROLLUP_ADDRESS, -1, "0");
    }

    // // Show prior summary row if resuming
    // if (fromEpoch > 0) {
    //   const { resultArr, cum: prevCum } = await fetchHistory(
    //     provider,
    //     ROLLUP_ADDRESS,
    //     proverAddress,
    //     fromEpoch - 1,
    //     "0"
    //   );
    //   liveResults = [...resultArr];
    //   cum = prevCum;
    //   lastFinalizedEpoch = fromEpoch - 1;
    //   lastFinalizedCum = prevCum;
    // }

    if (fromEpoch > 0) {
      // Only create a summary row, no RPC calls!
      liveResults = [{
        epoch: `0–${fromEpoch-1}`,
        rewards: '-',
        rewardsSTK: '-',
        cumulativeSTK: parseFloat(ethers.formatEther(BigInt(startCumulative))).toFixed(6),
        isPending: false,
        status: 'Loaded from DB',
      }];
      cum = BigInt(startCumulative);
      lastFinalizedEpoch = fromEpoch - 1;
      lastFinalizedCum = cum;
    }


    const lastFinalizedToScan = toEpoch - 2;
    for (let i = fromEpoch; i <= lastFinalizedToScan; i++) {
      if (stopped.current) {
        if (lastFinalizedEpoch >= 0) {
          await saveProgress(
            proverAddress,
            ROLLUP_ADDRESS,
            lastFinalizedEpoch,
            lastFinalizedCum.toString()
          );
        }
        break;
      }
      const r = await fetchEpochReward(provider, ROLLUP_ADDRESS, proverAddress, i, cum);
      liveResults.push(r);
      cum = r.cumulative;
      setResults([...liveResults]);
      setFinalizedTotal(ethers.formatEther(cum));
      setProgress({ current: i + 1, total: toEpoch });
      lastFinalizedEpoch = i;
      lastFinalizedCum = cum;
      await sleep(500);
    }
    setLoading(false);

    // Save finalized progress
    if (!stopped.current && lastFinalizedEpoch >= 0) {
      await saveProgress(
        proverAddress,
        ROLLUP_ADDRESS,
        lastFinalizedEpoch,
        lastFinalizedCum.toString()
      );
    }
    setFinalizedTotal(ethers.formatEther(lastFinalizedCum));

    // Fetch pending epoch (currentEpoch-1) but do NOT save it
    if (lastFinalizedEpoch + 1 < toEpoch) {
      const pending = await fetchEpochReward(
        provider,
        ROLLUP_ADDRESS,
        proverAddress,
        lastFinalizedEpoch + 1,
        lastFinalizedCum
      );
      pending.isPending = true;
      setPendingReward(pending.rewardsSTK);
      setResults(prev => [...liveResults, pending]);
    }
  };

  useEffect(() => {
    if (!resumeChoice || !resumeData) return;
    (async () => {
      if (resumeChoice === "restart") {
        await scanRewards(0, resumeData.latestEpoch, "0", true);
      } else {
        await scanRewards(resumeData.lastEpoch + 1, resumeData.latestEpoch, resumeData.cumulative, false);
      }
      setResumeChoice(null);
      setResumeData(null);
    })();
    // eslint-disable-next-line
  }, [resumeChoice, resumeData]);

  // UI
  return (
    <div className="min-h-screen bg-gradient-to-tr from-[#181A20] via-[#232532] to-[#1a1c22] py-12 px-4 sm:px-8 dark">
      <div className="max-w-3xl mx-auto">
        <div className="bg-[#22242B] rounded-2xl shadow-xl shadow-black/40 border border-[#23242d] p-10 mb-8">
          <h1 className="text-4xl font-extrabold mb-2 text-white tracking-tight">Prover Rewards Checker</h1>
          <p className="text-lg text-gray-400 mb-6">Monitor your rollup prover rewards in real time.</p>
          {/* Contract Selector */}
          <div className="mb-6">
            <label className="block text-sm font-semibold mb-2 text-gray-300">Rollup Contract</label>
            <div className="flex gap-4 flex-wrap">
              <div className="w-full flex justify-center mb-6">
                <div className="flex gap-2 w-full max-w-lg">
                  {CONTRACT_OPTIONS.map((opt) => {
                    const selected = contractKey === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setContractKey(opt.key)}
                        className={[
                          "relative flex-1 py-2 sm:py-2.5 px-2 sm:px-3 rounded-full font-bold text-sm sm:text-base focus:outline-none transition-all duration-200",
                          selected ? "text-white shadow-lg" : "text-purple-200 hover:text-white",
                          selected ? "overflow-hidden z-10" : "",
                        ].join(' ')}
                        style={{ minWidth: 0 }}
                      >
                        {selected && (
                          <span
                            className="absolute inset-0 rounded-full z-0 animate-gradient-move"
                            style={{
                              background: "linear-gradient(90deg, #fc5c7d 0%, #ffb367 100%)",
                              filter: "brightness(1.07)",
                            }}
                            aria-hidden="true"
                          />
                        )}
                        {!selected && (
                          <span
                            className="absolute inset-0 rounded-full z-0"
                            style={{
                              background: "linear-gradient(90deg, #32215e 0%, #7c58c3 100%)",
                              opacity: 0.85,
                            }}
                            aria-hidden="true"
                          />
                        )}
                        <span className="relative z-10">{opt.name.toUpperCase()}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <label className="block text-sm font-semibold mb-2 text-gray-300">Prover Address</label>
              <input
                type="text"
                value={proverAddress}
                onChange={(e) => setProverAddress(e.target.value)}
                className="w-full bg-[#191b23] text-white rounded-lg px-4 py-3 focus:ring-2 focus:ring-[#7F56D9] border-none placeholder:text-gray-500 transition"
                placeholder="0x..."
                spellCheck={false}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-2 text-gray-300">RPC URL (Optional)</label>
              <input
                type="text"
                value={rpcUrl}
                onChange={(e) => setRpcUrl(e.target.value)}
                className="w-full bg-[#191b23] text-white rounded-lg px-4 py-3 focus:ring-2 focus:ring-[#4285F4] border-none placeholder:text-gray-500 transition"
                placeholder={DEFAULT_RPCS.join(", ")}
                spellCheck={false}
              />
            </div>
          </div>
          <button
            onClick={startScan}
            disabled={loading}
            className="w-full bg-gradient-to-tr from-[#4285F4] to-[#7F56D9] hover:brightness-110 text-white font-bold py-3 px-6 rounded-xl shadow-md shadow-black/20 transition-all flex items-center justify-center disabled:opacity-50 mt-2"
          >
            {loading ? <Spinner /> : 'Check Rewards'}
            {loading && (
              <span className="ml-2">
                {progress.total > 0
                  ? `Scanning ${progress.current}/${progress.total - 1} epochs...`
                  : "Initializing..."}
              </span>
            )}
          </button>
          {loading && (
            <button
              onClick={handleStop}
              className="w-full mt-2 py-2 rounded-xl font-semibold bg-gradient-to-tr from-red-500 to-pink-500 hover:brightness-110 text-white shadow-md shadow-black/20 transition-all"
            >
              Stop Scanning
            </button>
          )}
        </div>
        {/* Resume Dialog */}
        {resumeData && !loading && resumeChoice === null && (
          <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-60 z-50">
            <div className="bg-[#191b23] border border-[#23242d] rounded-2xl shadow-lg px-8 py-8 max-w-md w-full flex flex-col items-center text-white">
              <div className="text-xl font-bold mb-3">Resume Previous Scan?</div>
              <div className="mb-6 text-center text-gray-300 text-base">
                Previous scan for this prover and contract stopped at <span className="font-mono text-[#F5B74E]">epoch {resumeData.lastEpoch}</span>.<br />
                <span className="text-gray-400">Would you like to resume scanning from epoch {resumeData.lastEpoch + 1}, or start from the beginning?</span>
              </div>
              <div className="flex gap-3 w-full">
                <button
                  className="flex-1 py-2 rounded-xl font-semibold bg-gradient-to-tr from-[#4285F4] to-[#7F56D9] hover:brightness-110 transition"
                  onClick={() => setResumeChoice('resume')}
                >Resume</button>
                <button
                  className="flex-1 py-2 rounded-xl font-semibold bg-gradient-to-tr from-[#fc5c7d] to-[#ffb367] hover:brightness-110 transition"
                  onClick={() => setResumeChoice('restart')}
                >Start Over</button>
              </div>
            </div>
          </div>
        )}
        {error && (
          <div className="bg-[#2D1E1E] border-l-4 border-red-600 text-red-400 px-6 py-4 rounded-xl mb-4 shadow">
            {error}
          </div>
        )}
        {currentEpoch !== null && (
          <div className="bg-[#24253e] border-l-4 border-[#4285F4] text-gray-100 px-6 py-4 rounded-xl mb-6 shadow">
            <p><strong>Current Epoch:</strong> <span className="text-[#7F56D9]">{currentEpoch - 1}</span></p>
            <p><strong>Rollup Contract:</strong> <span className="text-[#4285F4] font-mono">{ROLLUP_ADDRESS}</span></p>
          </div>
        )}
        {results.length > 0 && (
          <div className="bg-[#22242B] rounded-2xl shadow-xl p-8 border border-[#23242d]">
            <div className="mt-0 mb-5 p-5 bg-gradient-to-tr from-[#232532] via-[#1a1c22] to-[#181A20] rounded-xl flex flex-col shadow">
              <span className="text-lg font-bold text-white mr-2">
                Total Cumulative Rewards <span className="text-sm text-[#F5B74E]">*</span>:
              </span>
              <span className="text-2xl font-mono text-[#4285F4]">
                {parseFloat(finalizedTotal).toFixed(6)} STK
                {pendingReward && pendingReward !== "0.000000" && (
                  <span className="text-[#F5B74E] text-xl font-mono"> (+{pendingReward} STK)</span>
                )}
              </span>
              <span className="mt-2 text-[#F5B74E] text-sm">
                * Only finalized epochs count toward the total. The latest epoch is still pending and may decrease if more provers submit.
              </span>
              {shares !== null && (
                <span className="mt-2 text-[#F5B74E] text-base font-mono">
                  <strong>Current Shares:</strong> {formatBigIntWithCommas(shares)}
                </span>
              )}
            </div>
            <h2 className="text-2xl font-bold mb-6 text-white">Rewards by Epoch</h2>
            <div className="overflow-x-auto rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gradient-to-r from-[#7F56D9] to-[#4285F4] text-white">
                    <th className="px-6 py-4 text-left rounded-tl-xl">Epoch</th>
                    <th className="px-6 py-4 text-right">Rewards (STK)</th>
                    <th className="px-6 py-4 text-right">Cumulative (STK)</th>
                    <th className="px-6 py-4 text-center rounded-tr-xl">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Summary row for fast lookup */}
                  {results.length > 0 && results[0].status === 'Loaded from DB' && (
                    <tr className="bg-[#15171d]">
                      <td className="px-6 py-3 text-gray-400 font-mono italic">{results[0].epoch}</td>
                      <td className="px-6 py-3 text-right text-gray-400 font-mono italic">–</td>
                      <td className="px-6 py-3 text-right text-[#F5B74E] font-mono font-bold">{results[0].cumulativeSTK}</td>
                      <td className="px-6 py-3 text-center text-gray-400 italic">{results[0].status}</td>
                    </tr>
                  )}
                  {/* Finalized epochs */}
                  {results
                    .slice(results.length > 0 && results[0].status === 'Loaded from DB' ? 1 : 0)
                    .filter(r => !r.isPending)
                    .map((result, i) => (
                      <tr
                        key={result.epoch}
                        className={`transition-colors duration-100 ${
                          i % 2 === 0 ? 'bg-[#23242d]' : 'bg-[#1e2028]'
                        } hover:bg-[#24253e]`}
                      >
                        <td className="px-6 py-3 text-white font-mono">{result.epoch}</td>
                        <td className="px-6 py-3 text-right text-[#7F56D9] font-mono font-bold">{result.rewardsSTK}</td>
                        <td className="px-6 py-3 text-right text-[#F5B74E] font-mono">{result.cumulativeSTK}</td>
                        <td className="px-6 py-3 text-center"></td>
                      </tr>
                    ))
                  }
                  {/* Pending epoch (currentEpoch - 1) */}
                  {results.some(r => r.isPending) && (() => {
                    const pending = results.find(r => r.isPending);
                    return (
                      <tr className="bg-[#23242d]">
                        <td className="px-6 py-3 text-white font-mono">{pending.epoch}</td>
                        <td className="px-6 py-3 text-right text-[#7F56D9] font-mono font-bold">{pending.rewardsSTK}</td>
                        <td className="px-6 py-3 text-right text-[#F5B74E] font-mono">{pending.cumulativeSTK}</td>
                        <td className="px-6 py-3 text-center">
                          <span className="text-[#F5B74E] font-semibold">In Progress*</span>
                        </td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
            <div className="mt-4 text-[#F5B74E] text-sm">
              * Only finalized epochs count toward the total. The latest epoch is still pending and may decrease if more provers submit.
            </div>
          </div>
        )}
      </div>
      <Analytics />
    </div>
  );
}
