'use client';

import { useState } from 'react';
import { ethers } from 'ethers';

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

export default function Home() {
  const [proverAddress, setProverAddress] = useState('your-prover-address-here');
  const [rpcUrl, setRpcUrl] = useState('https://your-rpc-url.com:8545 (https only)');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [currentEpoch, setCurrentEpoch] = useState<number | null>(null);
  const [totalRewards, setTotalRewards] = useState<string>('0');
  const [error, setError] = useState<string>('');
  const [progress, setProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });

  const ROLLUP_ADDRESS = "0x216f071653a82ced3ef9d29f3f0c0ed7829c8f81";

  const checkRewards = async () => {
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
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-tr from-[#181A20] via-[#232532] to-[#1a1c22] py-12 px-4 sm:px-8 dark">
      <div className="max-w-3xl mx-auto">
        <div className="bg-[#22242B] rounded-2xl shadow-xl shadow-black/40 border border-[#23242d] p-10 mb-8">
          <h1 className="text-4xl font-extrabold mb-2 text-white tracking-tight">Prover Rewards Checker</h1>
          <p className="text-lg text-gray-400 mb-6">Monitor your rollup prover rewards in real time.</p>
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
                placeholder="http://..."
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
