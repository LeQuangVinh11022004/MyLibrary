import { BrowserProvider, Contract, isAddress } from "ethers";

const SEPOLIA_CHAIN_ID = "0xaa36a7";
const registryAddress = import.meta.env.VITE_FILE_HASH_REGISTRY_ADDRESS?.trim();
const REGISTRY_ABI = [
  "function anchor(bytes32 fileHash)",
  "function anchoredAt(address owner, bytes32 fileHash) view returns (uint256)",
  "event FileHashAnchored(address indexed owner, bytes32 indexed fileHash, uint256 timestamp)",
];

export async function anchorOrVerifyFileHash(blob) {
  if (!registryAddress || !isAddress(registryAddress)) {
    throw new Error("Chưa cấu hình địa chỉ FileHashRegistry đã triển khai trên Sepolia.");
  }
  if (!window.ethereum) {
    throw new Error("Cài ví Ethereum tương thích như MetaMask để chủ động ký giao dịch.");
  }
  const chainId = await window.ethereum.request({ method: "eth_chainId" });
  if (chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error("Hãy chuyển ví sang Sepolia trước khi neo hash.");
  }
  if (!crypto.subtle) throw new Error("Trình duyệt cần HTTPS để tạo hash an toàn.");
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  const fileHash = `0x${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  await window.ethereum.request({ method: "eth_requestAccounts" });
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const registry = new Contract(registryAddress, REGISTRY_ABI, signer);
  const account = await signer.getAddress();
  const existingTimestamp = await registry.anchoredAt(account, fileHash);
  if (existingTimestamp > 0n) {
    return { status: "verified", timestamp: Number(existingTimestamp) };
  }
  const transaction = await registry.anchor(fileHash);
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) throw new Error("Giao dịch chưa được xác nhận trên Sepolia.");
  return { status: "anchored", transactionHash: transaction.hash };
}

export const isHashRegistryConfigured = Boolean(registryAddress && isAddress(registryAddress));
