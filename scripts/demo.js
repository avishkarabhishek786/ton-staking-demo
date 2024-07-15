(async () => {

    const { ethers } = require("hardhat");
    const helpers = require("@nomicfoundation/hardhat-network-helpers");
    const hre = require("hardhat");
    require('dotenv').config()

    const FACTORY_ABI = require('./abis/factory.json');
    const POOL_ABI = require('./abis/pool.json');
    const SWAP_ROUTER_ABI = require('./abis/swapRouter.json');
    const WETH_ABI = require('./abis/weth.json');
    const WTON_ABI = require('./abis/wton.json');
    const QUOTER_ABI = require('./abis/quoter.json');
    const LAYER2_REGISTRY_ABI = require('./abis/layer2Registry.json');
    const DEPOSIT_MANAGER_ABI = require('./abis/depositManager.json');
    const SEIG_MANAGER_ABI = require('./abis/seigManager.json');
    const CANDIDATE_PROXY_ABI = require('./abis/candidateProxy.json');
    const REFACTOR_COINAGE_SNAPSHOT_ABI = require('./abis/refactorCoinageSnapshot.json');

    // Deployment ETHEREUM MAINNET Addresses
    const POOL_FACTORY_CONTRACT_ADDRESS = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
    const QUOTER_CONTRACT_ADDRESS = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e';
    const SWAP_ROUTER_CONTRACT_ADDRESS = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';
    const DEPOSIT_MANAGER_ADDRESS = '0x0b58ca72b12f01fc05f8f252e226f3e2089bd00e';
    const LAYER2_REGISTRY_ADDRESS = '0x0b3E174A2170083e770D5d4Cf56774D221b7063e';
    const SEIG_MANAGER_ADDRESS = '0x0b55a0f463b6DEFb81c6063973763951712D0E5F';
    const layer2Address = '0xf3B17FDB808c7d0Df9ACd24dA34700ce069007DF';

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


    // Provider, Contract & Signer Instances
    const [deployer] = await ethers.getSigners();
    const provider = new ethers.providers.JsonRpcProvider("http://localhost:8545")
    const factoryContract = new ethers.Contract(POOL_FACTORY_CONTRACT_ADDRESS, FACTORY_ABI, deployer);
    const quoterContract = new ethers.Contract(QUOTER_CONTRACT_ADDRESS, QUOTER_ABI, deployer)
    const WETHContract = new ethers.Contract(WETH.address, WETH_ABI, deployer);
    const WTONContract = new ethers.Contract(WTON.address, WTON_ABI, deployer);
    const LAYER2REGISTRYContract = new ethers.Contract(LAYER2_REGISTRY_ADDRESS, LAYER2_REGISTRY_ABI, deployer);
    const DepositManagerContract = new ethers.Contract(DEPOSIT_MANAGER_ADDRESS, DEPOSIT_MANAGER_ABI, deployer);
    const SeigManagerContract = new ethers.Contract(SEIG_MANAGER_ADDRESS, SEIG_MANAGER_ABI, deployer);

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

    async function getPoolInfo(deployer, factoryContract, tokenIn, tokenOut) {
        const poolAddress = await factoryContract.getPool(tokenIn.address, tokenOut.address, 3000);
        if (!poolAddress) {
            throw new Error("Failed to get pool address");
        }
        const poolContract = new ethers.Contract(poolAddress, POOL_ABI, deployer);
        const [token0, token1, fee] = await Promise.all([
            poolContract.token0(),
            poolContract.token1(),
            poolContract.fee(),
        ]);
        return { poolContract, token0, token1, fee };
    }

    async function prepareSwapParams(poolContract, deployer, amountIn, amountOut) {
        amountIn = String((amountIn));
        amountOut = String(ethers.utils.parseUnits(String(parseInt(amountOut)), WTON.decimals));
        return {
            tokenIn: WETH.address,
            tokenOut: WTON.address,
            fee: await poolContract.fee(),
            recipient: deployer.address,
            deadline: Math.floor(Date.now() / 1000) + 60 * 20,
            amountIn: amountIn,
            amountOutMinimum: amountOut,
            sqrtPriceLimitX96: 0,
        };
    }

    async function quoteAndLogSwap(quoterContract, fee, deployer, amountIn) {
        const quotedAmountOut = await quoterContract.callStatic.quoteExactInputSingle({
            tokenIn: WETH.address,
            tokenOut: WTON.address,
            fee: fee,
            recipient: deployer.address,
            deadline: Math.floor(new Date().getTime() / 1000 + 60 * 10),
            amountIn: amountIn,
            sqrtPriceLimitX96: 0,
        });
        console.log(`-------------------------------`)
        console.log(`Token Swap will result in: ${ethers.utils.formatUnits(quotedAmountOut[0].toString(), WTON.decimals)} ${WTON.symbol} for ${ethers.utils.formatEther(amountIn)} ${WETH.symbol}`);
        const amountOut = ethers.utils.formatUnits(quotedAmountOut[0], WTON.decimals)
        return amountOut;
    }

    async function executeSwap(swapRouter, params, deployer) {
        const transaction = await swapRouter.populateTransaction.exactInputSingle(params);
        const receipt = await deployer.sendTransaction(transaction);
        console.log(`-------------------------------`)
        console.log(`Receipt: https://etherscan.io/tx/${receipt.hash}`);
        console.log(`-------------------------------`)
    }

    async function swapWethToWton(deployer, factoryContract, quoterContract, WETHContract, WTONContract, ethAmount, swapAmount, minimumAmountOut) {

        try {

            const inputAmount = swapAmount
            const amountIn = ethers.utils.parseUnits(inputAmount.toString(), 18);
            minimumAmountOut = ethers.utils.parseUnits(minimumAmountOut.toString(), WTON.decimals);

            // Check deployer balance
            const balance = await deployer.getBalance();
            console.log("Current ETH balance:", ethers.utils.formatEther(balance), `\n`);

            await getWETH(ethAmount);

            const userWethBalance = Number(ethers.utils.formatEther(await WETHContract.balanceOf(deployer.getAddress())));
            console.log("Balances after ETH->WETH swap:-");
            console.log(`Current WETH balance: ${userWethBalance} \n`);
            console.log("Current ETH balance:", ethers.utils.formatEther(await deployer.getBalance()), `\n`);
            const WTONBalance0 = Number(ethers.utils.parseUnits(String(await WTONContract.balanceOf(deployer.getAddress())), WTON.decimals));
            console.log(`Current WTON Balance: ${WTONBalance0}`)

            await approveToken(WETH.address, WETH_ABI, amountIn, deployer)
            const { poolContract, token0, token1, fee } = await getPoolInfo(deployer, factoryContract, WETH, WTON);
            console.log(`-------------------------------`)
            console.log(`Fetching Quote for: ${WETH.symbol} to ${WTON.symbol}`);
            console.log(`-------------------------------`)
            console.log(`Swap Amount: ${ethers.utils.formatEther(amountIn)}`);

            const quotedAmountOut = await quoteAndLogSwap(quoterContract, fee, deployer, amountIn);

            const params = await prepareSwapParams(poolContract, deployer, amountIn, quotedAmountOut);
            //const params = await prepareSwapParams(poolContract, deployer, amountIn, 0);

            const swapRouter = new ethers.Contract(SWAP_ROUTER_CONTRACT_ADDRESS, SWAP_ROUTER_ABI, deployer);
            await executeSwap(swapRouter, params, deployer);

            const userWethBalance1 = Number(ethers.utils.formatEther(await WETHContract.balanceOf(deployer.getAddress())));

            console.log(`\n-------------------------------`)
            console.log("Balances after WETH->WTON swap:-");
            console.log(`New WETH balance: ${userWethBalance1} \n`);

            const WTONBalance1 = Number(ethers.utils.formatUnits(String(await WTONContract.balanceOf(deployer.getAddress())), WTON.decimals));
            console.log(`New WTON Balance: ${WTONBalance1}`)
            console.log(`-------------------------------\n`)

        } catch (error) {
            console.error("An error occurred:", error);
        }
    }

    async function depositWton(wton_staking_amount, layer2Index = 0) {
        try {

            // fetch a layer2 address
            //const layer2Address = await LAYER2REGISTRYContract.layer2ByIndex(layer2Index);
            //const layer2Address = '0xf3B17FDB808c7d0Df9ACd24dA34700ce069007DF';
            console.log(`Fetching a layer2 Address:`, layer2Address, '\n');

            // approve WTON to DepositManager contract
            const wtonApproval = await WTONContract.populateTransaction.approve(DEPOSIT_MANAGER_ADDRESS, wton_staking_amount);
            const wtonApprovalReceipt = await deployer.sendTransaction(wtonApproval);
            const wtonApproved = String(await WTONContract.allowance(deployer.address, DEPOSIT_MANAGER_ADDRESS));

            console.log(`-------------------------------`)
            console.log(`DepositManager approved to spend ${wtonApproved} WTON for ${deployer.address}`)
            console.log(`Receipt: https://etherscan.io/tx/${wtonApprovalReceipt.hash}\n`);
            console.log(`-------------------------------`)

            // call DepositManagerContract => deposit(address layer2, uint256 amount)
            const depositWtonTx = await DepositManagerContract.populateTransaction.deposit(layer2Address, wton_staking_amount)
            const depositWtonTxReceipt = await deployer.sendTransaction(depositWtonTx);

            console.log(`-------------------------------`)
            console.log(`WTON successfully deposited into the DepositManager.`)
            console.log(`Receipt: https://etherscan.io/tx/${depositWtonTxReceipt.hash}`);
            console.log(`-------------------------------`)

            // Fetch the coinage addres where the deposit was made
            const coinageAddress = await SeigManagerContract.coinages(layer2Address);
            const coinageContract = new ethers.Contract(coinageAddress, REFACTOR_COINAGE_SNAPSHOT_ABI, deployer);
            const coinageBalance = await coinageContract.balanceOf(deployer.address);
            console.log("SWTON balance after deposit:", ethers.utils.formatUnits(coinageBalance, 27));
            const newWtonBalance = await WTONContract.balanceOf(deployer.address);
            console.log("WTON balance after deposit:", ethers.utils.formatUnits(newWtonBalance, 27));

        } catch (e) {
            console.error(e)
        }
    }

    async function callUpdateSeigniorage() {
        try {
            const topUp = ethers.utils.parseEther("100").toHexString();
            await provider.send("hardhat_setBalance", [layer2Address, topUp]);

            console.log('layer2 ETH balance after topup', ethers.utils.formatUnits(String(await provider.getBalance(layer2Address)), 18))

            await provider.send("hardhat_impersonateAccount", [layer2Address]);

            const layer2Signer = provider.getSigner(layer2Address);

            // Call the updateSeigniorage function from the Layer2 address
            const updateSeigniorageTx = await SeigManagerContract.connect(layer2Signer).updateSeigniorage();
            await updateSeigniorageTx.wait();
            console.log("updateSeigniorage function ran successfully");
            
        } catch (error) {
            console.error(error)
        }
    }

    async function main() {

        const NUM_ETH_TO_WETH = 10;
        const NUM_WETH_TO_WTON = 1;
        const NUM_MIN_WTON = 0;
        const NUM_WTON_STAKE = ethers.utils.parseUnits('1000', 27);
        const LAYER2_INDEX = 0;

        await swapWethToWton(deployer, factoryContract, quoterContract, WETHContract, WTONContract, NUM_ETH_TO_WETH, NUM_WETH_TO_WTON, NUM_MIN_WTON);   

        await depositWton(NUM_WTON_STAKE, LAYER2_INDEX);

        console.log("Block number before mining", await helpers.time.latestBlock());
        console.log("Mining 10 blocks")
        // mine 10 blocks 
        await helpers.mine(10);
  
        console.log("Block number after mining", await helpers.time.latestBlock());

        callUpdateSeigniorage()

    }

    main();



})()