const { ethers } = require("hardhat");
require('dotenv').config()

const FACTORY_ABI = require('./abis/factory.json');
const POOL_ABI = require('./abis/pool.json');
const SWAP_ROUTER_ABI = require('./abis/swapRouter.json');
const WETH_ABI = require('./abis/weth.json');
const WTON_ABI = require('./abis/wton.json');
const QUOTER_ABI = require('./abis/quoter.json');

// Deployment Addresses
const POOL_FACTORY_CONTRACT_ADDRESS = '0x1F98431c8aD98523631AE4a59f267346ea31F984'
const QUOTER_CONTRACT_ADDRESS = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e'
const SWAP_ROUTER_CONTRACT_ADDRESS = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'

// Token Configuration
const WETH = {
    chainId: 1,
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    decimals: 18,
    symbol: 'WETH',
    name: 'Wrapped Ether',
    isToken: true,
    isNative: true,
    wrapped: true
  }
  
const WTON = {
    chainId: 1,
    address: '0xc4A11aaf6ea915Ed7Ac194161d2fC9384F15bff2',
    decimals: 27,
    symbol: 'WTON',
    name: 'Wrapped TON',
    isToken: true,
    isNative: true,
    wrapped: true
}

async function getWETH(ethAmount) {
    //const [deployer] = await ethers.getSigners();
    const WETHContract = await ethers.getContractAt(WETH_ABI, WETH.address);

    const weiAmt = ethers.utils.parseEther(ethAmount.toString());
    const tx = await WETHContract.deposit({ value: weiAmt });
    await tx.wait();
    console.log("WETH amount wrapped", Number(ethers.utils.formatEther(weiAmt)));
}

async function approveToken(tokenAddress, tokenABI, amount, wallet) {
    try {
        const tokenContract = new ethers.Contract(tokenAddress, tokenABI, wallet);

        const approveTransaction = await tokenContract.populateTransaction.approve(
            SWAP_ROUTER_CONTRACT_ADDRESS,
            ethers.utils.parseEther(amount.toString())
        );

        const transactionResponse = await wallet.sendTransaction(approveTransaction);
        console.log(`-------------------------------`)
        console.log(`Sending Approval Transaction...`)
        console.log(`-------------------------------`)
        //console.log(`Transaction Sent: ${transactionResponse.hash}`)
        console.log(`-------------------------------`)
        const receipt = await transactionResponse.wait();
        console.log(`Approval Transaction Confirmed! https://etherscan.io/txn/${transactionResponse.hash}`);
    } catch (error) {
        console.error("An error occurred during token approval:", error);
        throw new Error("Token approval failed");
    }
}

async function getPoolInfo(signer, factoryContract, tokenIn, tokenOut) {
    const poolAddress = await factoryContract.getPool(tokenIn.address, tokenOut.address, 3000);
    if (!poolAddress) {
        throw new Error("Failed to get pool address");
    }
    const poolContract = new ethers.Contract(poolAddress, POOL_ABI, signer);
    const [token0, token1, fee] = await Promise.all([
        poolContract.token0(),
        poolContract.token1(),
        poolContract.fee(),
    ]);
    return { poolContract, token0, token1, fee };
}

async function prepareSwapParams(poolContract, signer, amountIn, amountOut) {
    amountIn = String((amountIn));
    amountOut = String(ethers.utils.parseUnits(String(parseInt(amountOut)), WTON.decimals));
    return {
        tokenIn: WETH.address,
        tokenOut: WTON.address,
        fee: await poolContract.fee(),
        recipient: signer.address,
        deadline: Math.floor(Date.now() / 1000) + 60 * 20, 
        amountIn: amountIn,
        amountOutMinimum: amountOut,
        sqrtPriceLimitX96: 0,
    };
}

async function quoteAndLogSwap(quoterContract, fee, signer, amountIn) {
    const quotedAmountOut = await quoterContract.callStatic.quoteExactInputSingle({
        tokenIn: WETH.address,
        tokenOut: WTON.address,
        fee: fee,
        recipient: signer.address,
        deadline: Math.floor(new Date().getTime() / 1000 + 60 * 10),
        amountIn: amountIn,
        sqrtPriceLimitX96: 0,
    });
    console.log(`-------------------------------`)
    console.log(`Token Swap will result in: ${ethers.utils.formatUnits(quotedAmountOut[0].toString(), WTON.decimals)} ${WTON.symbol} for ${ethers.utils.formatEther(amountIn)} ${WETH.symbol}`);
    const amountOut = ethers.utils.formatUnits(quotedAmountOut[0], WTON.decimals)
    return amountOut;
}

async function executeSwap(swapRouter, params, signer) {
    const transaction = await swapRouter.populateTransaction.exactInputSingle(params);
    const receipt = await signer.sendTransaction(transaction);
    console.log(`-------------------------------`)
    console.log(`Receipt: https://etherscan.io/tx/${receipt.hash}`);
    console.log(`-------------------------------`)
}

async function swapWethToWton(signer, factoryContract, quoterContract, WETHContract, WTONContract, ethAmount, swapAmount, minimumAmountOut) {

    try {

        const inputAmount = swapAmount
        const amountIn = ethers.utils.parseUnits(inputAmount.toString(), 18);
        minimumAmountOut = ethers.utils.parseUnits(minimumAmountOut.toString(), WTON.decimals);

        // Check signer balance
        const balance = await signer.getBalance();
        console.log("Current ETH balance:", ethers.utils.formatEther(balance), `\n`);

        await getWETH(ethAmount);

        const userWethBalance = Number(ethers.utils.formatEther(await WETHContract.balanceOf(signer.getAddress())));
        console.log("Balances after ETH->WETH swap:-");
        console.log(`Current WETH balance: ${userWethBalance} \n`);
        console.log("Current ETH balance:", ethers.utils.formatEther(await signer.getBalance()), `\n`);
        const WTONBalance0 = Number(ethers.utils.parseUnits(String(await WTONContract.balanceOf(signer.getAddress())), WTON.decimals));
        console.log(`Current WTON Balance: ${WTONBalance0}`)
        
        await approveToken(WETH.address, WETH_ABI, amountIn, signer)
        const { poolContract, token0, token1, fee } = await getPoolInfo(signer, factoryContract, WETH, WTON);
        console.log(`-------------------------------`)
        console.log(`Fetching Quote for: ${WETH.symbol} to ${WTON.symbol}`);
        console.log(`-------------------------------`)
        console.log(`Swap Amount: ${ethers.utils.formatEther(amountIn)}`);

        const quotedAmountOut = await quoteAndLogSwap(quoterContract, fee, signer, amountIn);

        const params = await prepareSwapParams(poolContract, signer, amountIn, quotedAmountOut);
        //const params = await prepareSwapParams(poolContract, signer, amountIn, 0);
        
        const swapRouter = new ethers.Contract(SWAP_ROUTER_CONTRACT_ADDRESS, SWAP_ROUTER_ABI, signer);
        await executeSwap(swapRouter, params, signer);

        const userWethBalance1 = Number(ethers.utils.formatEther(await WETHContract.balanceOf(signer.getAddress())));
        
        console.log(`\n-------------------------------`)
        console.log("Balances after WETH->WTON swap:-");
        console.log(`New WETH balance: ${userWethBalance1} \n`);

        const WTONBalance1 = Number(ethers.utils.formatUnits(String(await WTONContract.balanceOf(signer.getAddress())), WTON.decimals));
        console.log(`New WTON Balance: ${WTONBalance1}`)
        console.log(`-------------------------------\n`)
    
    } catch (error) {
        console.error("An error occurred:", error);
    }
}



async function main() {

    // Provider, Contract & Signer Instances
    const [deployer] = await ethers.getSigners();
    //const provider = new ethers.JsonRpcProvider(process.env.ETH_NODE_URI_MAINNET)
    const factoryContract = new ethers.Contract(POOL_FACTORY_CONTRACT_ADDRESS, FACTORY_ABI, deployer);
    
    const quoterContract = new ethers.Contract(QUOTER_CONTRACT_ADDRESS, QUOTER_ABI, deployer)

    const WETHContract = new ethers.Contract(WETH.address, WETH_ABI, deployer);
    const WTONContract = new ethers.Contract(WTON.address, WTON_ABI, deployer);
    
    swapWethToWton(deployer, factoryContract, quoterContract, WETHContract, WTONContract, 10, 1, 0);   
    
    
}

main();

