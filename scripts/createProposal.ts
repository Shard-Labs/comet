import hre from 'hardhat';
import { exp, proposal } from '../src/deploy';
import { IGovernorBravo } from '../build/types';


const eth_governor = '0xc0Da02939E1441F497fd74F78cE7Decb17B66529';
const eth_fxRoot = '0xfe5e5D361b2ad62c541bAb87C45a0B9B018389a2';

const pol_STMATIC = '0x3A58a54C066FdC0f2D55FC9C89F0415C92eBf3C4';
const pol_STMATIC_PRICE_FEED = '0x97371dF4492605486e23Da797fA68e55Fc38a13f';
const pol_comet = '0xF25212E676D1F7F89Cd72fFEe66158f541246445';
const pol_configurator = '0x83E0F742cAcBE66349E3701B171eE2487a26e738';
const pol_bridgeReceiver = '0x18281dfC4d00905DA1aaA6731414EABa843c468A';
const pol_cometAdmin = '0xd712ACe4ca490D4F3E92992Ecf3DE12251b975F9';

const createProposal = async () => {
  const newAssetConfig = {
    asset: pol_STMATIC,
    priceFeed: pol_STMATIC_PRICE_FEED,
    decimals: 18,
    borrowCollateralFactor: exp(0.8, 18),
    liquidateCollateralFactor: exp(0.85, 18),
    liquidationFactor: exp(0.95, 18),
    supplyCap: exp(10000000, 18)
  };

  const addAssetConfigCalldata = hre.ethers.utils.defaultAbiCoder.encode(
    ['address', '(address,address,uint8,uint64,uint64,uint64,uint128)'],
    [
      pol_comet,
      [
        newAssetConfig.asset,
        newAssetConfig.priceFeed,
        newAssetConfig.decimals,
        newAssetConfig.borrowCollateralFactor,
        newAssetConfig.liquidateCollateralFactor,
        newAssetConfig.liquidationFactor,
        newAssetConfig.supplyCap
      ]
    ]
  );

  const deployAndUpgradeToCalldata = hre.ethers.utils.defaultAbiCoder.encode(
    ['address', 'address'],
    [pol_configurator, pol_comet]
  );

  const l2ProposalData = hre.ethers.utils.defaultAbiCoder.encode(
    ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
    [
      [pol_configurator, pol_cometAdmin],
      [0, 0],
      [
        'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        'deployAndUpgradeTo(address,address)'
      ],
      [addAssetConfigCalldata, deployAndUpgradeToCalldata]
    ]
  );

  const fxRoot = await hre.ethers.getContractAt(
    [
      {
        inputs: [
          { internalType: 'address', name: '_receiver', type: 'address' },
          { internalType: 'bytes', name: '_data', type: 'bytes' }
        ],
        name: 'sendMessageToChild',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function'
      }
    ],
    eth_fxRoot
  );

  const actions = [
    // 1. add stMATIC asset and deployAndUpgradeTo new Comet on Polygon.
    {
      contract: fxRoot,
      signature: 'sendMessageToChild(address,bytes)',
      args: [pol_bridgeReceiver, l2ProposalData]
    }
  ];

  const description =
    '# Add stMATIC as Collateral to cUSDCv3 Polygon\nThis proposal adds stMATIC as collateral.\n';

  const proposalCalldata = await proposal(actions, description);

  const governorBravo = (await hre.ethers.getContractAt(
    'IGovernorBravo',
    eth_governor
  )) as IGovernorBravo;

  const txn = await governorBravo.propose(...proposalCalldata);
  const event = (await txn.wait()).events.find(event => event.event === 'ProposalCreated');

  const [proposalId] = event.args;
  console.log(`Created proposal ${proposalId}.`);
};

createProposal()
  .then()
  .catch(e => console.log(e));
