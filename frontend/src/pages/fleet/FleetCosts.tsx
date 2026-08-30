import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useOutletContext, useNavigate } from 'react-router-dom';
import { DollarSign, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

const FleetCosts: React.FC = () => {
  const { fleetId } = useParams<{ fleetId?: string }>();
  const { loadFleets } = useOutletContext<any>();
  const navigate = useNavigate();
  const [fleetDetails, setFleetDetails] = useState<any>(null);

  const fetchFleetDetails = async () => {
    try {
      const res = await api.get(`/fleets/${fleetId}`);
      setFleetDetails(res.data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (fleetId) fetchFleetDetails();
  }, [fleetId]);

  // Calculate dynamic monthly Infrastructure Burn Rate from actual resources
  const infrastructureBurnRate = useMemo(() => {
    if (!fleetDetails?.instances) return 0;
    let cost = 0;
    const pricingMapPerDay: Record<string, number> = {
      'e2-micro': 50,
      'e2-small': 100,
      'e2-medium': 200,
      'e2-standard-2': 400,
    };
    fleetDetails.instances.forEach((inst: any) => {
      const perDayCost = pricingMapPerDay[inst.machineType] || 100;
      cost += perDayCost * 30; // monthly rate
    });
    return cost;
  }, [fleetDetails]);

  const handleDeleteFleet = async () => {
    if (!fleetId) return;
    if (!window.confirm("Are you sure you want to destroy this entire fleet and all its agents? This action is irreversible.")) return;
    try {
      await api.delete(`/fleets/${fleetId}`);
      await loadFleets();
      navigate('/dashboard');
    } catch (e) {
      console.error("Failed to delete fleet");
    }
  };

  if (!fleetDetails) return <div className="p-8 text-muted-foreground">Loading costs...</div>;

  return (
    <div className="p-8 h-full overflow-y-auto">
      <div className="mb-6 border-b border-border pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <DollarSign className="text-muted-foreground" size={24} /> Costs & Billing
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Manage cloud resources and account wallet billing.</p>
        </div>
        <Button
          variant="outline"
          onClick={handleDeleteFleet}
          className="border-red-500/20 text-red-500 hover:bg-red-500/10"
        >
          <Trash2 size={16} /> Destroy Fleet
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 text-left">
        <Card>
          <div className="text-sm font-medium text-muted-foreground mb-2 uppercase tracking-wider">Infrastructure Burn</div>
          <div className="text-4xl font-bold h-12 flex items-center">
            {infrastructureBurnRate} <span className="text-xl font-normal text-muted-foreground ml-2">Credits/mo</span>
          </div>
          <div className="text-xs text-muted-foreground mt-2 bg-secondary/50 p-2 rounded inline-block">Billed to your wallet balance.</div>
        </Card>

        <Card>
          <div className="text-sm font-medium text-muted-foreground mb-2 uppercase tracking-wider">Inference Agent Spend</div>
          <div className="text-4xl font-bold h-12 flex items-center text-emerald-400">
            {(fleetDetails.apiCreditsUsed || 0).toFixed(2)} <span className="text-xl font-normal text-muted-foreground ml-2">Credits</span>
          </div>
          <div className="text-xs text-muted-foreground mt-2 bg-secondary/50 p-2 rounded inline-block">Total API usage consumed by all active roster instances.</div>
        </Card>
      </div>

      {/* Agents Token / Credit Usage details table */}
      <Card className="text-left">
        <h3 className="text-sm font-semibold tracking-wider text-foreground uppercase font-mono mb-4">Roster Consumption Analytics</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-muted-foreground">
            <thead className="text-xs text-muted-foreground uppercase font-mono border-b border-border">
              <tr>
                <th className="pb-3">Agent</th>
                <th className="pb-3 text-center">Runtime</th>
                <th className="pb-3 text-right">Inference Charges</th>
              </tr>
            </thead>
            <tbody>
              {fleetDetails.instances?.map((inst: any) => (
                <tr key={inst.id || inst._id} className="border-b border-border/40 hover:bg-secondary/40">
                  <td className="py-3 font-medium text-foreground">
                    <div className="font-mono text-xs">{inst.role}</div>
                    <div className="text-[11px] text-muted-foreground">{inst.title}</div>
                  </td>
                  <td className="py-3 text-center font-mono text-xs text-muted-foreground">{inst.iteration || inst.agentType || 'openclaw'}</td>
                  <td className="py-3 text-right font-mono font-bold text-emerald-400 text-xs">
                    {(inst.apiCreditsUsed || 0).toFixed(2)} CR
                  </td>
                </tr>
              ))}
              {(!fleetDetails.instances || fleetDetails.instances.length === 0) && (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-xs italic text-muted-foreground">No active roster instances found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

export default FleetCosts;
