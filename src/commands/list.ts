import statusCommand from './status';

const listCommand = () => {
  statusCommand({ short: true });
};

export default listCommand;
