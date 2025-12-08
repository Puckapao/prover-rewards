'use client';

import { Analytics } from '@vercel/analytics/next';
import { useEffect, useRef, useState } from "react";
import { ethers } from 'ethers';

// Contract choices
const CONTRACT_OPTIONS = [
  // { key: '1st', name: '1st', address: '0x8D1cc702453fa889f137DBD5734CDb7Ee96B6Ba0' },
  // { key: '2nd', name: '2nd', address: '0xee6d4e937f0493fb461f28a75cf591f1dba8704e' },
  // { key: 'adv', name: 'Adversarial', address: '0x216f071653a82ced3ef9d29f3f0c0ed7829c8f81' },
  // { key: 'testnet', name: 'Testnet', address: '0x29fa27e173f058d0f5f618f5abad2757747f673f'},
  // { key: '2.1.2 testnet', name: '2.1.2 Testnet', address: '0xebd99ff0ff6677205509ae73f93d0ca52ac85d67'},
  { key: 'mainnet', name: 'Mainnet Ignition', address: '0x603bb2c05D474794ea97805e8De69bCcFb3bCA12' }
];

const DEFAULT_RPCS = [
  // "https://1rpc.io/sepolia",
  // "https://ethereum-sepolia-rpc.publicnode.com",
  "https://eth.llamarpc.com",
  "wss://ethereum-rpc.publicnode.com",
  "https://1rpc.io/eth",
  "https://eth.drpc.org",
  "https://ethereum-rpc.publicnode.com"
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
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
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


// Helper to get ETH price at a specific timestamp (fallback to current price)
async function getEthPriceAtTimestamp(timestamp: number) {
  try {
    // Convert timestamp to date
    const date = new Date(timestamp * 1000);
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD format

    // Try to get historical price from a free API
    const response = await fetch(`https://api.coingecko.com/api/v3/coins/ethereum/history?date=${dateStr.split('-').reverse().join('-')}&localization=false`);

    if (response.ok) {
      const data = await response.json();
      const price = data.market_data?.current_price?.usd;
      if (price) {
        console.log(`💰 ETH price on ${dateStr}: $${price}`);
        return price;
      }
    }
  } catch (error) {
    console.warn('⚠️ Failed to fetch historical ETH price, using current price');
  }

  // Fallback to current ETH price (~$2500 as approximate)
  return 2500;
}

// Helper to get epoch from timestamp using contract function
async function getEpochFromTimestamp(provider: any, rollup: string, timestamp: number) {
  try {
    const callData = ethers.concat([
      ethers.id("getEpochAt(uint256)").substring(0, 10),
      ethers.zeroPadValue(ethers.toBeHex(timestamp), 32),
    ]);
    const epochHex = await provider.call({ to: rollup, data: callData });
    const epoch = parseInt(epochHex, 16);
    console.log(`🕒 Timestamp ${timestamp} -> Epoch ${epoch}`);
    return epoch;
  } catch (error) {
    console.error(`❌ Failed to get epoch for timestamp ${timestamp}:`, error);
    return null;
  }
}

// Helper to get all transactions from a specific address using eth_getTransactionHistory (if available)
async function getUserTransactionHistory(provider: any, address: string, startBlock: number) {
  const transactions = [];

  // Method 1: Try using eth_getHistory or similar methods if available
  try {
    // Try Alchemy's specific endpoint
    const history = await provider.send("alchemy_getAssetTransfers", [{
      fromAddress: address,
      category: ["external"],
      withMetadata: true,
      excludeZeroValue: false,
      maxCount: "0x3e8" // 1000 transactions
    }]);

    if (history?.transfers) {
      for (const transfer of history.transfers) {
        if (transfer.hash) {
          transactions.push(transfer.hash);
        }
      }
      console.log(`📝 Found ${transactions.length} transactions using Alchemy method`);
      return transactions;
    }
  } catch (alchemyError) {
    console.log("⚠️ Alchemy method not available, using event-based approach");
  }

  // Method 2: Fallback - scan event logs for specific method signature
  try {
    const latestBlock = await provider.getBlockNumber();
    const methodSignature = "0x46c6dfdf"; // Submit Epoch Root Proof method signature

    console.log(`🔍 Scanning for transactions with method ${methodSignature} from ${address}`);

    // Get all logs from the rollup contract
    const chunkSize = 2000; // Larger chunks since we're filtering by topic
    let currentBlock = startBlock;

    while (currentBlock <= latestBlock) {
      const endBlock = Math.min(currentBlock + chunkSize, latestBlock);

      try {
        // Look for transactions with specific method signature
        const filter = {
          fromBlock: currentBlock,
          toBlock: endBlock,
          topics: [methodSignature] // Filter by method signature
        };

        const logs = await provider.getLogs(filter);
        console.log(`📍 Found ${logs.length} method calls in blocks ${currentBlock}-${endBlock}`);

        for (const log of logs) {
          const tx = await provider.getTransaction(log.transactionHash);
          if (tx && tx.from.toLowerCase() === address.toLowerCase()) {
            transactions.push(log.transactionHash);
            console.log(`✅ Found Submit Epoch Root Proof tx: ${log.transactionHash} at block ${tx.blockNumber}`);
          }
        }

        currentBlock = endBlock + 1;
      } catch (chunkError) {
        console.log(`⚠️ Error in chunk ${currentBlock}-${endBlock}, reducing chunk size`);
        // Reduce chunk size and continue
        const newChunkSize = Math.max(100, Math.floor(chunkSize / 2));
        currentBlock += newChunkSize;
      }
    }
  } catch (eventError) {
    console.error("❌ Event-based method failed:", eventError);
  }

  console.log(`🎯 Found total ${transactions.length} Submit Epoch Root Proof transactions`);
  return [...new Set(transactions)]; // Remove duplicates
}

// Helper to fetch user transactions to rollup contract and calculate gas costs
async function fetchUserGasCosts(provider: any, rollup: string, prover: string, lastGasScanBlock: number, progressCallback: (progress: string) => void) {
  try {
    console.log(`🔍 Searching for Submit Epoch Root Proof transactions from: ${prover}`);

    const startBlock = 23831788; // Block where epoch 235 started
    progressCallback("Finding Submit Epoch Root Proof transactions...");

    // Get all Submit Epoch Root Proof transactions from this user
    const txHashes = await getUserTransactionHistory(provider, prover, startBlock);

    if (txHashes.length === 0) {
      progressCallback("No Submit Epoch Root Proof transactions found");
      return { gasCostsByEpoch: {}, totalGasETH: "0", totalGasUSD: "0" };
    }

    progressCallback(`Found ${txHashes.length} transactions. Analyzing gas costs...`);
    console.log(`📋 Analyzing gas costs for ${txHashes.length} Submit Epoch Root Proof transactions`);

    const gasCostsByEpoch: { [epoch: number]: { gasUsed: bigint, gasCostETH: string, gasCostUSD: string, txCount: number } } = {};
    let totalGasETH = 0;
    let totalGasUSD = 0;
    let processedTxs = 0;

    // Process each transaction to calculate gas costs
    for (const txHash of txHashes) {
      try {
        processedTxs++;
        const progressPercent = Math.round((processedTxs / txHashes.length) * 100);
        progressCallback(`Analyzing transactions... ${progressPercent}% (${processedTxs}/${txHashes.length}) | Total Gas: ${totalGasETH.toFixed(6)} ETH ($${totalGasUSD.toFixed(2)})`);

        const tx = await provider.getTransaction(txHash);
        const receipt = await provider.getTransactionReceipt(txHash);

        if (!tx || !receipt) {
          console.warn(`⚠️ Could not get transaction data for ${txHash}`);
          continue;
        }

        // Verify this is a Submit Epoch Root Proof transaction
        if (tx.data && !tx.data.startsWith("0x46c6dfdf")) {
          console.log(`⏭️ Skipping non-Submit Epoch Root Proof tx: ${txHash}`);
          continue;
        }

        const block = await provider.getBlock(tx.blockNumber);
        console.log(`✅ Processing Submit Epoch Root Proof tx: ${txHash} at block ${tx.blockNumber}`);

        // Calculate epoch from timestamp
        const epoch = await getEpochFromTimestamp(provider, rollup, block.timestamp);
        console.log(`📅 Transaction timestamp: ${block.timestamp}, calculated epoch: ${epoch}`);

        if (epoch !== null && epoch >= 235) {
          const gasUsed = receipt.gasUsed;
          const gasPrice = tx.gasPrice || BigInt(0);
          const gasCostWei = gasUsed * gasPrice;
          const gasCostETH = parseFloat(ethers.formatEther(gasCostWei));

          // Get ETH price at transaction time for USD calculation
          const ethPrice = await getEthPriceAtTimestamp(block.timestamp);
          const gasCostUSD = gasCostETH * ethPrice;

          if (!gasCostsByEpoch[epoch]) {
            gasCostsByEpoch[epoch] = { gasUsed: BigInt(0), gasCostETH: "0", gasCostUSD: "0", txCount: 0 };
          }

          gasCostsByEpoch[epoch].gasUsed = gasCostsByEpoch[epoch].gasUsed + gasUsed;
          gasCostsByEpoch[epoch].gasCostETH = ethers.formatEther(
            ethers.parseEther(gasCostsByEpoch[epoch].gasCostETH) + gasCostWei
          );
          gasCostsByEpoch[epoch].gasCostUSD = (
            parseFloat(gasCostsByEpoch[epoch].gasCostUSD) + gasCostUSD
          ).toFixed(2);
          gasCostsByEpoch[epoch].txCount = gasCostsByEpoch[epoch].txCount + 1;

          // Update running totals
          totalGasETH += gasCostETH;
          totalGasUSD += gasCostUSD;

          console.log(`💰 Added gas cost for epoch ${epoch}: ${gasCostETH.toFixed(6)} ETH ($${gasCostUSD.toFixed(2)}) | Running total: ${totalGasETH.toFixed(6)} ETH ($${totalGasUSD.toFixed(2)})`);
        } else {
          console.log(`⏭️ Skipping transaction before epoch 235: epoch ${epoch}`);
        }

        // Small delay to avoid rate limiting
        if (processedTxs % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

      } catch (txError) {
        console.warn(`⚠️ Error processing transaction ${txHash}:`, txError.message);
      }
    }

    progressCallback(`Complete! Analyzed ${processedTxs} transactions across ${Object.keys(gasCostsByEpoch).length} epochs. Total: ${totalGasETH.toFixed(6)} ETH ($${totalGasUSD.toFixed(2)})`);
    console.log(`📈 Final gas costs by epoch:`, gasCostsByEpoch);
    return { gasCostsByEpoch, totalGasETH: totalGasETH.toFixed(6), totalGasUSD: totalGasUSD.toFixed(2) };

  } catch (error) {
    console.error('❌ Failed to fetch gas costs:', error);
    progressCallback('❌ Error occurred while scanning for gas costs');
    return { gasCostsByEpoch: {}, totalGasETH: "0", totalGasUSD: "0" };
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
    shares: sharesNum.toString(),
    sharesNum,
  };
}

export default function Home() {
  const [shares, setShares] = useState<string | null>(null);
  const [proverAddress, setProverAddress] = useState('');
  const [rpcUrl, setRpcUrl] = useState('');
  const [contractKey, setContractKey] = useState('mainnet');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [currentEpoch, setCurrentEpoch] = useState<number | null>(null);
  const [finalizedTotal, setFinalizedTotal] = useState<string>('0');
  const [pendingReward, setPendingReward] = useState<string>('0');
  const [error, setError] = useState<string>('');
  const [progress, setProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [resumeData, setResumeData] = useState<{ lastEpoch: number, cumulative: string, latestEpoch: number } | null>(null);
  const [resumeChoice, setResumeChoice] = useState<'resume' | 'restart' | null>(null);
  const [gasCosts, setGasCosts] = useState<{ [epoch: number]: { gasUsed: bigint, gasCostETH: string, txCount: number } }>({});
  const [totalGasCost, setTotalGasCost] = useState<string>('0');
  const [totalGasCostUSD, setTotalGasCostUSD] = useState<string>('0');
  const [gasScanning, setGasScanning] = useState(false);
  const [gasScanProgress, setGasScanProgress] = useState<string>('');
  const [showGasCostModal, setShowGasCostModal] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvError, setCsvError] = useState<string>('');

  const ROLLUP_ADDRESS = CONTRACT_OPTIONS.find(opt => opt.key === contractKey)?.address ?? CONTRACT_OPTIONS[2].address;
  const stopped = useRef(false);
  const handleStop = () => { stopped.current = true; };

  // Function to validate and process CSV file
  const processCsvFile = async (file: File) => {
    try {
      setCsvError('');
      setGasScanning(true);
      setGasScanProgress('Processing CSV file...');

      // Validate file name format
      const expectedPrefix = `export-${proverAddress.toLowerCase()}`;
      if (!file.name.toLowerCase().startsWith(expectedPrefix)) {
        throw new Error(`File name should start with "${expectedPrefix}"`);
      }

      // Read file content
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());

      if (lines.length < 2) {
        throw new Error('CSV file appears to be empty or invalid');
      }

      // Parse CSV headers
      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
      const requiredColumns = ['Method', 'TxnFee(ETH)', 'TxnFee(USD)'];

      for (const col of requiredColumns) {
        if (!headers.includes(col)) {
          throw new Error(`Missing required column: ${col}`);
        }
      }

      const methodIndex = headers.indexOf('Method');
      const ethFeeIndex = headers.indexOf('TxnFee(ETH)');
      const usdFeeIndex = headers.indexOf('TxnFee(USD)');

      setGasScanProgress('Analyzing Submit Epoch Root Proof transactions...');

      // Process data rows
      let totalETH = 0;
      let totalUSD = 0;
      let txCount = 0;

      for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split(',').map(cell => cell.trim().replace(/"/g, ''));

        if (row.length < headers.length) continue; // Skip incomplete rows

        const method = row[methodIndex];
        if (method === 'Submit Epoch Root Proof') {
          const ethFee = parseFloat(row[ethFeeIndex]) || 0;
          const usdFee = parseFloat(row[usdFeeIndex]) || 0;

          totalETH += ethFee;
          totalUSD += usdFee;
          txCount++;
        }
      }

      setGasScanProgress(`Found ${txCount} Submit Epoch Root Proof transactions`);
      setTotalGasCost(totalETH.toFixed(6));
      setTotalGasCostUSD(totalUSD.toFixed(2));
      setShowGasCostModal(false);

      console.log(`📊 Processed CSV: ${txCount} transactions, ${totalETH.toFixed(6)} ETH, $${totalUSD.toFixed(2)} USD`);

    } catch (error) {
      setCsvError(error.message || 'Failed to process CSV file');
      console.error('CSV processing error:', error);
    } finally {
      setGasScanning(false);
      setGasScanProgress('');
    }
  };

  // Handle CSV file selection
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.csv')) {
        setCsvError('Please select a CSV file');
        return;
      }
      setCsvFile(file);
      setCsvError('');
    }
  };

  // Function to show gas cost modal
  const showGasCostAnalysis = () => {
    setShowGasCostModal(true);
    setCsvFile(null);
    setCsvError('');
  };

  useEffect(() => {
    setProverAddress(getCookie('proverAddress') || 'your-prover-address-here (0x...)');
    setRpcUrl(getCookie('rpcUrl'));
  }, []);
  useEffect(() => { if (proverAddress) setCookie('proverAddress', proverAddress); }, [proverAddress]);
  useEffect(() => { if (rpcUrl) setCookie('rpcUrl', rpcUrl); }, [rpcUrl]);

  const getProgress = async (prover: string, contract: string) => {
    const r = await fetch(`/api/progress?prover=${encodeURIComponent(prover)}&contract=${encodeURIComponent(contract)}`);
    if (!r.ok) return { lastEpoch: -1, cumulativeRewards: "0", lastGasScanBlock: -1 };
    const data = await r.json();
    return {
      lastEpoch: typeof data.lastEpoch === "number" ? data.lastEpoch : -1,
      cumulativeRewards: data.cumulativeRewards || "0",
      lastGasScanBlock: typeof data.lastGasScanBlock === "number" ? data.lastGasScanBlock : -1,
    };
  };
  const saveProgress = async (prover: string, contract: string, lastEpoch: number, cumulativeRewards: string, lastGasScanBlock?: number) => {
    const body: any = { prover, contract, lastEpoch, cumulativeRewards };
    if (lastGasScanBlock !== undefined) {
      body.lastGasScanBlock = lastGasScanBlock;
    }
    await fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

      // Gas costs are now calculated manually by user request


      const currentEpochHex = await provider.call({
        to: ROLLUP_ADDRESS,
        data: ethers.id("getCurrentEpoch()").substring(0, 10),
      });
      const latestEpoch = parseInt(currentEpochHex, 16);
      setCurrentEpoch(latestEpoch);
      setProgress({ current: 235, total: latestEpoch });

      // Get DB progress
      const { lastEpoch, cumulativeRewards } = await getProgress(proverAddress, ROLLUP_ADDRESS);
      const lastFinalizedEpoch = latestEpoch - 2;

      // If we're already at tip, just show summary + pending row
      if (lastEpoch >= lastFinalizedEpoch) {
        setResults([
          {
            epoch: `235–${lastEpoch}`,
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
          const pending = await fetchEpochReward(provider, ROLLUP_ADDRESS, proverAddress, latestEpoch - 1, BigInt(cumulativeRewards));
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
            epoch: `235–${lastEpoch}`,
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

      // No progress, scan all starting from epoch 235
      await scanRewards(235, latestEpoch, "0", true);
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


    // Optionally reset progress ONLY IF starting over from epoch 235
    if (overwriteDB && fromEpoch === 235) {
      await saveProgress(proverAddress, ROLLUP_ADDRESS, 234, "0");
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

    if (fromEpoch > 235) {
      // Only create a summary row, no RPC calls!
      liveResults = [{
        epoch: `235–${fromEpoch - 1}`,
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
        await scanRewards(235, resumeData.latestEpoch, "0", true);
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
    <div
      className="min-h-screen py-4 px-4 sm:px-6 relative font-sans"
      style={{
        background: `
          radial-gradient(circle at 15% 25%, #4A5FCC 0%, transparent 50%),
          radial-gradient(circle at 85% 15%, #FF6B35 0%, transparent 45%),
          radial-gradient(circle at 20% 80%, #9B59B6 0%, transparent 40%),
          radial-gradient(circle at 75% 70%, #E74C3C 0%, transparent 35%),
          radial-gradient(circle at 50% 30%, #3498DB 0%, transparent 55%),
          radial-gradient(circle at 90% 85%, #F39C12 0%, transparent 30%),
          radial-gradient(circle at 10% 60%, #E91E63 0%, transparent 45%),
          radial-gradient(circle at 60% 10%, #1ABC9C 0%, transparent 40%),
          linear-gradient(135deg, #2C3E50 0%, #34495E 100%)
        `
      }}
    >
      <div className="max-w-4xl mx-auto relative z-10">
        {/* Header with integrated mainnet selection */}
        <div className="text-center mb-4 relative">
          <h1 className="text-xl md:text-2xl font-serif text-[#BFFF00] mb-2">
            <span className="not-italic">Pro</span><span className="italic">ver</span> <span className="italic">Re</span><span className="not-italic">wards</span> <span className="not-italic">for</span> <span className="italic">Az</span><span className="not-italic">tec</span>
            <div className="inline-flex gap-1 ml-2">
              {CONTRACT_OPTIONS.map((opt) => {
                const selected = contractKey === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setContractKey(opt.key)}
                    className={`
                      px-3 py-1 rounded-lg font-sans font-bold text-xs transition-all duration-300 border
                      ${selected
                        ? "bg-[#BFFF00]/20 border-[#BFFF00] text-[#BFFF00]"
                        : "bg-white/5 border-white/20 text-white/60 hover:border-[#BFFF00]/50 hover:text-white/90"
                      }
                    `}
                  >
                    {opt.name}
                  </button>
                );
              })}
            </div>
          </h1>
        </div>

        {/* Main Card */}
        <div
          className="rounded-2xl shadow-2xl p-6 mb-6 relative overflow-hidden"
          style={{ backgroundColor: '#2e0700' }}
        >
          <div className="relative z-10">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-sans font-semibold text-[#BFFF00] uppercase tracking-wider">Configuration</h2>
              <div className="text-right">
                <div className="text-white/60 uppercase tracking-wide text-xs">Rollup Address:</div>
                <div className="text-[#BFFF00]/80 font-mono text-xs">{ROLLUP_ADDRESS.slice(0, 10)}...{ROLLUP_ADDRESS.slice(-8)}</div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-xs font-sans font-medium mb-2 text-white/80 uppercase tracking-wide">Prover Address</label>
                <input
                  type="text"
                  value={proverAddress}
                  onChange={(e) => setProverAddress(e.target.value)}
                  className="w-full bg-black/30 text-white rounded-xl px-4 py-3 border-2 border-white/20 focus:border-[#BFFF00] focus:ring-0 placeholder:text-white/40 transition-all duration-300 font-mono text-sm"
                  placeholder="0x..."
                  spellCheck={false}
                />
              </div>
              <div>
                <label className="block text-xs font-sans font-medium mb-2 text-white/80 uppercase tracking-wide">RPC URL (Optional)</label>
                <input
                  type="text"
                  value={rpcUrl}
                  onChange={(e) => setRpcUrl(e.target.value)}
                  className="w-full bg-black/30 text-white rounded-xl px-4 py-3 border-2 border-white/20 focus:border-[#BFFF00] focus:ring-0 placeholder:text-white/40 transition-all duration-300 font-sans text-sm"
                  placeholder="Custom RPC endpoint..."
                  spellCheck={false}
                />
              </div>
            </div>
            <button
              onClick={startScan}
              disabled={loading}
              className="w-full bg-gradient-to-r from-[#BFFF00] to-[#BFFF00] hover:brightness-110 text-black font-sans font-bold py-3 px-6 rounded-xl shadow-xl shadow-[#BFFF00]/25 transition-all duration-300 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider text-sm"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-6 w-6 mr-3 text-black" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  <span>
                    {progress.total > 0
                      ? `Scanning ${progress.current}/${progress.total - 1} epochs...`
                      : "Initializing..."}
                  </span>
                </>
              ) : (
                'Check Rewards'
              )}
            </button>
            {loading && (
              <button
                onClick={handleStop}
                className="w-full mt-3 py-2 rounded-xl font-sans font-semibold bg-gradient-to-r from-[#FF6B35] to-[#FF6B35] hover:brightness-110 text-white shadow-lg shadow-[#FF6B35]/25 transition-all duration-300 uppercase tracking-wider text-sm"
              >
                Stop Scanning
              </button>
            )}
          </div>
        </div>
        {/* Resume Dialog */}
        {resumeData && !loading && resumeChoice === null && (
          <div className="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm z-50">
            <div
              className="border-2 border-[#BFFF00]/30 rounded-3xl shadow-2xl px-10 py-10 max-w-lg w-full mx-4 text-white relative overflow-hidden"
              style={{ backgroundColor: '#2e0700' }}
            >
              <div className="relative z-10">
                <div className="text-2xl font-sans font-bold mb-4 text-[#BFFF00] uppercase tracking-wide">Resume Scan?</div>
                <div className="mb-8 text-center text-white/90 text-base leading-relaxed">
                  Previous scan stopped at <span className="font-mono text-[#BFFF00] font-bold">epoch {resumeData.lastEpoch}</span>.<br />
                  <span className="text-white/60">Resume from epoch {resumeData.lastEpoch + 1}, or restart?</span>
                </div>
                <div className="flex gap-4 w-full">
                  <button
                    className="flex-1 py-3 rounded-2xl font-sans font-bold bg-[#BFFF00] text-black hover:brightness-110 transition-all duration-300 uppercase tracking-wide shadow-lg shadow-[#BFFF00]/25"
                    onClick={() => setResumeChoice('resume')}
                  >Resume</button>
                  <button
                    className="flex-1 py-3 rounded-2xl font-sans font-bold bg-[#FF6B35] text-white hover:brightness-110 transition-all duration-300 uppercase tracking-wide shadow-lg shadow-[#FF6B35]/25"
                    onClick={() => setResumeChoice('restart')}
                  >Start Over</button>
                </div>
              </div>
            </div>
          </div>
        )}
        {error && (
          <div
            className="border-2 border-[#FF6B35]/30 rounded-2xl px-6 py-4 mb-6 relative overflow-hidden"
            style={{
              background: `
                linear-gradient(135deg, rgba(255,107,53,0.1), rgba(255,107,53,0.05)),
                linear-gradient(135deg, rgba(20,10,10,0.9), rgba(40,20,20,0.9))
              `
            }}
          >
            <div className="text-[#FF6B35] font-semibold">⚠️ {error}</div>
          </div>
        )}
        {results.length > 0 && (
          <div
            className="rounded-2xl shadow-2xl p-6 border border-[#BFFF00]/20 mb-6 relative overflow-hidden"
            style={{ backgroundColor: '#2e0700' }}
          >

            {/* Rewards Summary */}
            <div
              className="relative z-10 p-4 rounded-lg border border-[#BFFF00]/30 mb-4"
              style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}
            >
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-sm font-bold text-[#BFFF00] mb-1 uppercase tracking-wider">
                    Total Rewards <span className="text-xs text-[#BFFF00]/60">*</span>
                  </h3>
                  <div className="text-lg md:text-xl font-mono text-white">
                    {parseFloat(finalizedTotal).toFixed(6)} <span className="text-[#BFFF00]">AZTEC</span>
                    {pendingReward && pendingReward !== "0.000000" && (
                      <span className="text-sm text-[#FF6B35] ml-2">
                        +{pendingReward} <span className="text-xs">(pending)</span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-mono text-green-400">
                    ≈ ${((parseFloat(finalizedTotal) + (pendingReward && pendingReward !== "0.000000" ? parseFloat(pendingReward) : 0)) * 0.035).toFixed(2)} USD (at $0.03 per AZTEC)
                  </div>
                </div>
              </div>
              {(totalGasCost !== '0' || gasScanning) && (
                <div
                  className="mt-3 p-3 rounded-lg border border-[#FF6B35]/30 relative overflow-hidden"
                  style={{ backgroundColor: 'rgba(255,107,53,0.1)' }}
                >
                  <div className="flex justify-between items-center">
                    <h4 className="text-xs font-bold text-[#FF6B35] uppercase tracking-wide">Gas Costs</h4>
                    {gasScanning ? (
                      <div className="flex-1 ml-4">
                        <div className="text-xs font-mono text-[#FF6B35]/80 mb-1">{gasScanProgress}</div>
                        <div className="w-full bg-black/30 rounded-full h-2 overflow-hidden">
                          <div className="bg-gradient-to-r from-[#FF6B35] to-[#BFFF00] h-2 rounded-full animate-pulse"></div>
                        </div>
                      </div>
                    ) : totalGasCost !== '0' ? (
                      <div className="text-right">
                        <div className="text-sm font-mono text-[#FF6B35] font-bold">
                          {parseFloat(totalGasCost).toFixed(6)} ETH
                        </div>
                        {totalGasCostUSD !== '0' && (
                          <div className="text-xs font-mono text-[#FF6B35]/70">
                            ${parseFloat(totalGasCostUSD).toFixed(2)} USD
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}

              {!gasScanning && totalGasCost === '0' && (
                <div className="mt-3 text-center">
                  <button
                    onClick={showGasCostAnalysis}
                    className="px-4 py-2 bg-gradient-to-r from-[#FF6B35] to-[#FF6B35] hover:brightness-110 text-white font-bold rounded-xl shadow-lg shadow-[#FF6B35]/25 transition-all duration-300 uppercase tracking-wide text-xs"
                  >
                    📊 Calculate Gas Costs
                  </button>
                </div>
              )}
              <div className="mt-4 pt-3 border-t border-[#BFFF00]/20">
                <div className="flex justify-between items-center text-xs">
                  <div className="text-[#BFFF00]/60 uppercase tracking-wider">
                    * Finalized epochs only • Pending epoch may change
                  </div>
                  {shares !== null && (
                    <div>
                      <span className="text-white/60 uppercase tracking-wide">Shares: </span>
                      <span className="text-[#BFFF00] font-mono font-bold">{formatBigIntWithCommas(shares)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="relative z-10 mt-6">
              <h3 className="text-lg font-bold mb-4 text-[#BFFF00] uppercase tracking-wider">Epoch Details</h3>
              <div className="overflow-hidden rounded-xl border border-[#BFFF00]/30">
                <table className="w-full">
                  <thead>
                    <tr
                      className="text-black font-bold"
                      style={{ background: 'linear-gradient(135deg, #BFFF00, #BFFF00)' }}
                    >
                      <th className="px-4 py-3 text-left uppercase tracking-wide text-sm">Epoch</th>
                      <th className="px-4 py-3 text-right uppercase tracking-wide text-sm">Rewards (AZTEC)</th>
                      <th className="px-4 py-3 text-right uppercase tracking-wide text-sm">Cumulative</th>
                      <th className="px-4 py-3 text-center uppercase tracking-wide text-sm">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Summary row for fast lookup */}
                    {results.length > 0 && results[0].status === 'Loaded from DB' && (
                      <tr className="bg-[#15171d]">
                        <td className="px-4 py-2 text-gray-400 font-mono italic text-sm">{results[0].epoch}</td>
                        <td className="px-4 py-2 text-right text-gray-400 font-mono italic text-sm">–</td>
                        <td className="px-4 py-2 text-right text-[#F5B74E] font-mono font-bold text-sm">{results[0].cumulativeSTK}</td>
                        <td className="px-4 py-2 text-center text-gray-400 italic text-sm">{results[0].status}</td>
                      </tr>
                    )}
                    {/* Finalized epochs */}
                    {results
                      .slice(results.length > 0 && results[0].status === 'Loaded from DB' ? 1 : 0)
                      .filter(r => !r.isPending)
                      .map((result, i) => (
                        <tr
                          key={result.epoch}
                          className={`transition-colors duration-100 ${i % 2 === 0 ? 'bg-[#23242d]' : 'bg-[#1e2028]'
                            } hover:bg-[#24253e]`}
                        >
                          <td className="px-4 py-2 text-white font-mono text-sm">{result.epoch}</td>
                          <td className="px-4 py-2 text-right text-[#7F56D9] font-mono font-bold text-sm">{result.rewardsSTK}</td>
                          <td className="px-4 py-2 text-right text-[#F5B74E] font-mono text-sm">{result.cumulativeSTK}</td>
                          <td className="px-4 py-2 text-center"></td>
                        </tr>
                      ))
                    }
                    {/* Pending epoch (currentEpoch - 1) */}
                    {results.some(r => r.isPending) && (() => {
                      const pending = results.find(r => r.isPending);
                      return (
                        <tr className="bg-[#23242d]">
                          <td className="px-4 py-2 text-white font-mono text-sm">{pending.epoch}</td>
                          <td className="px-4 py-2 text-right text-[#7F56D9] font-mono font-bold text-sm">{pending.rewardsSTK}</td>
                          <td className="px-4 py-2 text-right text-[#F5B74E] font-mono text-sm">{pending.cumulativeSTK}</td>
                          <td className="px-4 py-2 text-center">
                            <span className="text-[#F5B74E] font-semibold text-sm">In Progress*</span>
                          </td>
                        </tr>
                      );
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="mt-6 text-center text-[#BFFF00]/60 text-sm uppercase tracking-wider">
              * Finalized epochs only • Pending epoch may change
            </div>
          </div>
        )}
      </div>
      {/* Gas Cost CSV Upload Modal */}
      {showGasCostModal && (
      <div className="fixed inset-0 flex items-center justify-center bg-black/90 backdrop-blur-sm z-50">
        <div
          className="border-2 border-[#BFFF00]/30 rounded-3xl shadow-2xl px-10 py-10 max-w-2xl w-full mx-4 relative overflow-hidden"
          style={{ backgroundColor: '#2e0700' }}
        >
          <div className="relative z-10">
            <div className="text-center mb-8">
              <div className="text-3xl font-sans font-bold text-[#BFFF00] uppercase tracking-wide">📊 Gas Cost Analysis</div>
              <div className="text-[#BFFF00]/60 text-sm font-sans uppercase tracking-wider mt-2">Etherscan CSV Import</div>
            </div>

            <div className="mb-6 text-white/80">
              <p className="mb-3 font-sans">To analyze your gas costs, please download your transaction history from Etherscan:</p>
              <ol className="list-decimal list-inside space-y-2 text-sm font-sans">
                <li>Visit: <a
                  href={`https://etherscan.io/exportData?type=address&a=${proverAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#BFFF00] hover:underline break-all"
                >
                  https://etherscan.io/exportData?type=address&a={proverAddress}
                </a></li>
                <li>Set the start date to <strong className="text-[#BFFF00]">19 November 2025</strong></li>
                <li>Download the CSV file</li>
                <li>Upload it below</li>
              </ol>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-sans font-medium mb-2 text-white/80">
                Upload Etherscan CSV Export
              </label>
              <input
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                className="w-full bg-black/30 text-white rounded-lg px-4 py-3 border border-white/20 focus:ring-2 focus:ring-[#BFFF00] focus:border-[#BFFF00] file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-[#BFFF00] file:text-black file:cursor-pointer hover:file:brightness-110"
              />
              {csvError && (
                <p className="mt-2 text-sm text-red-400 font-sans">❌ {csvError}</p>
              )}
              {csvFile && (
                <p className="mt-2 text-sm text-[#BFFF00] font-sans">✅ File selected: {csvFile.name}</p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => csvFile && processCsvFile(csvFile)}
                disabled={!csvFile || gasScanning}
                className="flex-1 py-3 rounded-xl font-sans font-semibold bg-[#BFFF00] hover:brightness-110 text-black transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {gasScanning ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
                      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    {gasScanProgress || 'Processing...'}
                  </span>
                ) : (
                  'Analyze Gas Costs'
                )}
              </button>
              <button
                onClick={() => setShowGasCostModal(false)}
                disabled={gasScanning}
                className="flex-1 py-3 rounded-xl font-sans font-semibold bg-[#FF6B35] hover:brightness-110 text-white transition disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
      )}

      <Analytics />
    </div>
  );
}
