'use client';

import { useEffect, useRef, useState } from "react";
import { ethers } from 'ethers';


const CONTRACT_OPTIONS = [
  { key: '1st', name: '1st', address: '0x8D1cc702453fa889f137DBD5734CDb7Ee96B6Ba0' },
  { key: '2nd', name: '2nd', address: '0xee6d4e937f0493fb461f28a75cf591f1dba8704e' },
  { key: 'adv', name: 'Adversarial', address: '0x216f071653a82ced3ef9d29f3f0c0ed7829c8f81' },
];

function Spinner() {
  return (
    <svg className="animate-spin h-5 w-5 text-white inline-block mr-2" viewBox="0 0 24 24">
      <circle
        className="opacity-20"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v8z"
      />
    </svg>
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function RollupSelector({ options, value, onChange }) {
  return (
    <div className="w-full flex justify-center mb-6">
      <div className="flex gap-2 w-full max-w-lg">
        {options.map(opt => {
          const selected = value === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => onChange(opt.key)}
              className={[
                "relative flex-1 py-2 sm:py-2.5 px-2 sm:px-3 rounded-full font-bold text-sm sm:text-base focus:outline-none transition-all duration-200",
                selected
                  ? "text-white shadow-lg"
                  : "text-purple-200 hover:text-white",
                selected
                  ? "overflow-hidden z-10"
                  : "",
              ].join(' ')}
              style={{
                minWidth: 0,
              }}
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
              <span className="relative z-10">
                {opt.name.toUpperCase()}
              </span>
            </button>
          );
        })}
      </div>
      {/* Add the keyframes only once */}
      <style jsx>{`
        @keyframes gradient-move {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .animate-gradient-move {
          background-size: 200% 200%;
          animation: gradient-move 2s linear infinite;
        }
      `}</style>
    </div>
  );
}

function setCookie(name, value, days = 180) {
  const expires = new Date(Date.now() + days*24*60*60*1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}
function getCookie(name) {
  const v = document.cookie.match('(^|;) ?' + name + '=([^;]*)(;|$)');
  return v ? decodeURIComponent(v[2]) : '';
}


export default function Home() {
  const [proverAddress, setProverAddress] = useState('');
  const [rpcUrl, setRpcUrl] = useState('');
  const [contractKey, setContractKey] = useState('adv');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [currentEpoch, setCurrentEpoch] = useState<number | null>(null);
  const [totalRewards, setTotalRewards] = useState<string>('0');
  const [error, setError] = useState<string>('');
  const [progress, setProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });

  // Set contract dynamically
  const ROLLUP_ADDRESS = CONTRACT_OPTIONS.find(opt => opt.key === contractKey)?.address ?? CONTRACT_OPTIONS[2].address;

  const stopped = useRef(false);
  const handleStop = () => {
    stopped.current = true;
  };

  useEffect(() => {
    setProverAddress(getCookie('proverAddress') || 'your-prover-address-here (0x...)');
    setRpcUrl(getCookie('rpcUrl') || 'https://your-rpc-url.com (https only)');
  }, []);

  useEffect(() => {
    if (proverAddress) setCookie('proverAddress', proverAddress);
  }, [proverAddress]);
  useEffect(() => {
    if (rpcUrl) setCookie('rpcUrl', rpcUrl);
  }, [rpcUrl]);

  const checkRewards = async () => {
    stopped.current = false;

    setLoading(true);
    setError('');
    setResults([]);
    setTotalRewards('0');
    setProgress({ current: 0, total: 0 });

    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);

      // Get current epoch
      const currentEpochHex = await provider.call({
        to: ROLLUP_ADDRESS,
        data: ethers.id("getCurrentEpoch()").substring(0, 10),
      });
      const epoch = parseInt(currentEpochHex, 16);
      setCurrentEpoch(epoch);
      setProgress({ current: 0, total: epoch });

      let cumulativeRewards = BigInt(0);
      let liveResults: any[] = [];

      // Only loop up to currentEpoch - 1 (prover works on previous epoch)
      for (let i = 0; i < epoch; i++) {
        try {
          const callData = ethers.concat([
            ethers.id("getSpecificProverRewardsForEpoch(uint256,address)").substring(0, 10),
            ethers.zeroPadValue(ethers.toBeHex(i), 32),
            ethers.zeroPadValue(proverAddress, 32),
          ]);

          const rewardsHex = await provider.call({
            to: ROLLUP_ADDRESS,
            data: callData,
          });

          const rewards = BigInt(rewardsHex);
          const rewardsSTK = ethers.formatEther(rewards);

          const resultObj = {
            epoch: i,
            rewards: rewards.toString(),
            rewardsSTK: parseFloat(rewardsSTK).toFixed(6),
            isLatest: i === epoch - 1, // The last one is "In Progress"
          };
          liveResults = [...liveResults, resultObj];

          // Only sum finalized epochs (excluding latest/in-progress)
          if (i < epoch - 1) {
            cumulativeRewards += rewards;
          }

          setResults([...liveResults]);
          setTotalRewards(ethers.formatEther(cumulativeRewards));
        } catch (err) {
          // Optionally, you can append error info here as a result.
        }
        setProgress({ current: i + 1, total: epoch });
        await sleep(300);
        if (stopped.current) {
          break;
        }
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  // Optional: For persistence, add a backend API route and a DB (Vercel Postgres, Neon, etc.)
  // Save last scanned epoch and rewards for each prover address+contract.
  // On scan, start from last-saved+1 and append, or allow user to resume.

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
              <RollupSelector
                options={CONTRACT_OPTIONS}
                value={contractKey}
                onChange={setContractKey}
              />
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
              <label className="block text-sm font-semibold mb-2 text-gray-300">RPC URL</label>
              <input
                type="text"
                value={rpcUrl}
                onChange={(e) => setRpcUrl(e.target.value)}
                className="w-full bg-[#191b23] text-white rounded-lg px-4 py-3 focus:ring-2 focus:ring-[#4285F4] border-none placeholder:text-gray-500 transition"
                placeholder="https://..."
                spellCheck={false}
              />
            </div>
          </div>
          <button
            onClick={checkRewards}
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
              <span className="text-2xl font-mono text-[#4285F4]">{parseFloat(totalRewards).toFixed(6)} STK</span>
              <span className="mt-2 text-[#F5B74E] text-sm">
                * Only finalized epochs are included in the total. The latest epoch is still in progress and its rewards are not final.
              </span>
            </div>
            <h2 className="text-2xl font-bold mb-6 text-white">Rewards by Epoch</h2>
            <div className="overflow-x-auto rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gradient-to-r from-[#7F56D9] to-[#4285F4] text-white">
                    <th className="px-6 py-4 text-left rounded-tl-xl">Epoch</th>
                    <th className="px-6 py-4 text-right">Rewards (STK)</th>
                    <th className="px-6 py-4 text-center rounded-tr-xl">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((result, i) => (
                    <tr
                      key={result.epoch}
                      className={`transition-colors duration-100 ${
                        i % 2 === 0 ? 'bg-[#23242d]' : 'bg-[#1e2028]'
                      } hover:bg-[#24253e]`}
                    >
                      <td className="px-6 py-3 text-white font-mono">{result.epoch}</td>
                      <td className="px-6 py-3 text-right text-[#7F56D9] font-mono font-bold">{result.rewardsSTK}</td>
                      <td className="px-6 py-3 text-center">
                        {result.isLatest ? (
                          <span className="text-[#F5B74E] font-semibold">In Progress*</span>
                        ) : (
                          ''
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 text-[#F5B74E] text-sm">
              * The latest epoch is still being processed and its rewards may change until the epoch is finalized.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
